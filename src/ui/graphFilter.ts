// Pure transform collapsing the Project Graph Core's full node/edge set down
// to the File -> Class -> Method/Function hierarchy a workflow view actually
// needs (Fase 1.2, Epic E): the React Flow rebuild (Epic F) and any other
// consumer that only cares about that hierarchy (e.g. a future Calculate
// Impact view) call `filterGraphForWorkflow` instead of filtering
// `StoredGraph` themselves. Kept free of any vscode/rendering dependency,
// like `graphFocus.ts` and `sidebarData.ts`, so it can be unit tested
// directly against `StoredGraph` fixtures.
import { NODE_KINDS, NodeKind } from '../pipelines/model';
import { StoredEdge, StoredGraph } from '../core/store';

export const WORKFLOW_NODE_KINDS = ['file', 'class', 'method', 'function'] as const;

export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

export function isWorkflowNodeKind(kind: NodeKind): kind is WorkflowNodeKind {
	return (WORKFLOW_NODE_KINDS as readonly NodeKind[]).includes(kind);
}

/**
 * Every `NodeKind` this filter hides: `module`, `externalModule`,
 * `interface`, `property`, `variable`, `enum`, `typeAlias`. Derived from
 * `NODE_KINDS` rather than listed by hand so a future `NodeKind` addition to
 * `pipelines/model.ts` can't silently slip through this filter unclassified
 * — it will show up as hidden (or workflow-relevant) the moment it's added.
 */
export const HIDDEN_NODE_KINDS: readonly NodeKind[] = NODE_KINDS.filter((kind) => !isWorkflowNodeKind(kind));

function edgeDedupeKey(edge: Pick<StoredEdge, 'kind' | 'source' | 'target'>): string {
	return `${edge.kind}::${edge.source}::${edge.target}`;
}

/**
 * The workflow-relevant node id an edge synthesized by rerouting through
 * hidden nodes gets: unique per (kind, source, target) so the same real
 * connection reached through more than one hidden path — or a chain of
 * several hidden hops — still collapses onto a single edge.
 */
function reroutedEdgeId(kind: StoredEdge['kind'], source: string, target: string): string {
	return `workflow:${kind}:${source}:${target}`;
}

/**
 * Every outgoing edge from `hiddenId` that reaches a workflow-relevant node,
 * following chains of hidden nodes transitively. The edge kind/status/
 * metadata a caller ends up seeing for a multi-hop reroute is always the
 * *last* real edge's — the one that actually lands on the workflow node —
 * since that's the relation the hidden hops were standing in for.
 * `visited` (which already contains `hiddenId`) guards against cycles among
 * hidden nodes; a `contains` tree never has one, but nothing in the type
 * system guarantees that for edge kinds added later.
 */
function reachableWorkflowEdges(
	hiddenId: string,
	outgoingByNode: ReadonlyMap<string, StoredEdge[]>,
	isWorkflowNode: (id: string) => boolean,
	visited: ReadonlySet<string>
): StoredEdge[] {
	const outgoing = outgoingByNode.get(hiddenId) ?? [];
	const result: StoredEdge[] = [];
	for (const edge of outgoing) {
		if (isWorkflowNode(edge.target)) {
			result.push(edge);
		} else if (!visited.has(edge.target)) {
			result.push(...reachableWorkflowEdges(edge.target, outgoingByNode, isWorkflowNode, new Set(visited).add(edge.target)));
		}
	}
	return result;
}

/**
 * Collapses `graph` to just its workflow-relevant nodes (`file`, `class`,
 * `method`, `function`) and their edges, rerouting any edge that used to
 * pass through a hidden node (or a chain of several) so the real connection
 * it represented isn't lost — e.g. `function -> variable -> function`
 * becomes a direct `function -> function` edge. Edges entirely among hidden
 * nodes, or starting from a hidden node with no workflow-relevant ancestor,
 * are dropped: there is no workflow-relevant endpoint left to reroute them
 * to. Rerouted edges are deduplicated by (kind, source, target) and never
 * produce a self-loop.
 */
export function filterGraphForWorkflow(graph: StoredGraph): StoredGraph {
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
	const isWorkflowNode = (id: string): boolean => {
		const node = nodeById.get(id);
		return node !== undefined && isWorkflowNodeKind(node.kind);
	};

	const outgoingByNode = new Map<string, StoredEdge[]>();
	for (const edge of graph.edges) {
		const existing = outgoingByNode.get(edge.source);
		if (existing) {
			existing.push(edge);
		} else {
			outgoingByNode.set(edge.source, [edge]);
		}
	}

	const edges: StoredEdge[] = [];
	const seenEdgeKeys = new Set<string>();

	for (const edge of graph.edges) {
		if (!isWorkflowNode(edge.source)) {
			continue;
		}

		const terminalEdges = isWorkflowNode(edge.target)
			? [edge]
			: reachableWorkflowEdges(edge.target, outgoingByNode, isWorkflowNode, new Set([edge.target]));

		for (const terminal of terminalEdges) {
			const rerouted: StoredEdge =
				terminal === edge
					? edge
					: { ...terminal, id: reroutedEdgeId(terminal.kind, edge.source, terminal.target), source: edge.source };

			if (rerouted.source === rerouted.target) {
				continue;
			}
			const key = edgeDedupeKey(rerouted);
			if (seenEdgeKeys.has(key)) {
				continue;
			}
			seenEdgeKeys.add(key);
			edges.push(rerouted);
		}
	}

	return {
		nodes: graph.nodes.filter((node) => isWorkflowNodeKind(node.kind)),
		edges
	};
}
