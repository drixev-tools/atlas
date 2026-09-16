// "What happens when X runs": a bounded, cycle-safe subgraph of the Project
// Graph's `calls` edges only, followed breadth-first from a detected entry
// point (./entryPoints) for the flow view planned in Fase 1.3's Epic O.
// `imports`/`extends`/`implements`/`instantiates` never appear here — those
// are dependency/type relations, not "what runs next". Pure `StoredGraph`
// traversal, independent of any live `ProjectGraphStore` or rendering
// library, like ./diagramModel and ./moduleAggregation.
import { StoredEdge, StoredGraph, StoredNode } from './store';

export const DEFAULT_ENTRY_POINT_FLOW_MAX_DEPTH = 8;

export interface EntryPointFlow {
	entryPointId: string;
	nodes: StoredNode[];
	edges: StoredEdge[];
	/** Fewest `calls` hops from the entry point to reach each included node; 0 for the entry point itself. */
	depthById: Map<string, number>;
	/** Nodes left with at least one outgoing `calls` edge to a node that isn't in `nodes`/`edges`, only because following it would exceed `maxDepth` — the flow view's "there's more beyond this point" indicator. */
	truncatedNodeIds: Set<string>;
}

export interface EntryPointFlowOptions {
	/** How many `calls` hops from the entry point to follow before stopping. Clamped to at least 0. Defaults to `DEFAULT_ENTRY_POINT_FLOW_MAX_DEPTH`. */
	maxDepth?: number;
}

/**
 * Builds `entryPointNodeId`'s call flow from `graph`: every node reachable by
 * following `calls` edges outward, up to `maxDepth` hops, plus every `calls`
 * edge between two included nodes (not just the ones BFS actually walked) so
 * a branch that converges back onto an already-reached node — or a cycle
 * back onto an ancestor — still shows up as an edge instead of being
 * silently dropped. A node is only ever added to the flow once, at the
 * fewest hops it takes to reach it; that same "already reached" check is
 * what keeps a cycle from being walked forever. Returns `undefined` when
 * `entryPointNodeId` isn't a node in `graph`.
 */
export function buildEntryPointFlow(
	graph: StoredGraph,
	entryPointNodeId: string,
	options: EntryPointFlowOptions = {}
): EntryPointFlow | undefined {
	const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? DEFAULT_ENTRY_POINT_FLOW_MAX_DEPTH));

	const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
	if (!nodeById.has(entryPointNodeId)) {
		return undefined;
	}

	const callEdgesBySource = new Map<string, StoredEdge[]>();
	for (const edge of graph.edges) {
		if (edge.kind !== 'calls') {
			continue;
		}
		const existing = callEdgesBySource.get(edge.source);
		if (existing) {
			existing.push(edge);
		} else {
			callEdgesBySource.set(edge.source, [edge]);
		}
	}

	const depthById = new Map<string, number>([[entryPointNodeId, 0]]);
	const truncatedNodeIds = new Set<string>();
	const queue: string[] = [entryPointNodeId];

	while (queue.length > 0) {
		const currentId = queue.shift() as string;
		const depth = depthById.get(currentId) as number;
		const outgoing = callEdgesBySource.get(currentId) ?? [];

		if (depth >= maxDepth) {
			if (outgoing.some((edge) => nodeById.has(edge.target) && !depthById.has(edge.target))) {
				truncatedNodeIds.add(currentId);
			}
			continue;
		}

		for (const edge of outgoing) {
			if (nodeById.has(edge.target) && !depthById.has(edge.target)) {
				depthById.set(edge.target, depth + 1);
				queue.push(edge.target);
			}
		}
	}

	const nodes = [...depthById.keys()].map((id) => nodeById.get(id) as StoredNode);
	const edges = graph.edges.filter((edge) => edge.kind === 'calls' && depthById.has(edge.source) && depthById.has(edge.target));

	return { entryPointId: entryPointNodeId, nodes, edges, depthById, truncatedNodeIds };
}
