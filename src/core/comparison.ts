// Proposed vs Observed (Epic 10): matches a freshly-built Proposed Graph
// (Epic 9, see ../design/proposedGraph) against the Observed Graph already in
// the Project Graph store (Epics 2-4), and annotates every node/edge with the
// `GraphStatus` the schema already reserves for this (`matched` /
// `proposed_only` / `observed_only` — see ./schema). `matchNodes`/`matchEdges`
// are the pure comparison algorithm (task 1), exercised directly in tests;
// `reconcileProposedGraph` is the store-facing half that applies their result
// as status annotations (task 2).
import { CodeGraph, GraphEdge, GraphNode } from '../pipelines/model';
import { ProjectGraphStore } from './store';

/**
 * Identity a proposed node not resolved by id (see `matchNodes`) is compared
 * against: same kind, same name, in the same file. This is the fallback for
 * every kind but `file`/`externalModule`, whose proposed id already equals
 * the real pipelines' id scheme for the same entity (see
 * ../design/proposedGraph), so those match on id directly instead.
 */
function nodeIdentityKey(node: Pick<GraphNode, 'kind' | 'name' | 'filePath'>): string {
	return `${node.kind}::${node.name}::${node.filePath ?? ''}`;
}

function edgeIdentityKey(kind: string, source: string, target: string): string {
	return `${kind}::${source}::${target}`;
}

export interface NodeMatchResult {
	/** Every proposed node's id mapped to the id it should be stored/rendered under: the observed node's id when matched, its own id otherwise. */
	resolvedId: Map<string, string>;
	/** Ids (from `proposed`) of the proposed nodes that matched an observed node. */
	matchedProposedIds: Set<string>;
}

/**
 * Matches each `proposed` node against `observed` nodes, in two passes:
 *  1. Exact id equality — how `file` and `externalModule` proposed nodes
 *     match, since ../design/proposedGraph gives them the exact id scheme
 *     the extraction pipelines assign real ones.
 *  2. Same kind + name + file — the fallback for every other kind, whose
 *     proposed id can't be the pipelines' own (it encodes a source location
 *     a proposal doesn't have yet).
 * Each observed node is consumed by at most one match; when more than one
 * proposed node's identity key collides with several observed candidates
 * (e.g. two overloads), candidates are tried in a stable (id-sorted) order.
 */
export function matchNodes(observed: GraphNode[], proposed: GraphNode[]): NodeMatchResult {
	const observedById = new Map(observed.map((node) => [node.id, node]));

	const observedByKey = new Map<string, GraphNode[]>();
	for (const node of observed) {
		const key = nodeIdentityKey(node);
		const bucket = observedByKey.get(key);
		if (bucket) {
			bucket.push(node);
		} else {
			observedByKey.set(key, [node]);
		}
	}
	for (const bucket of observedByKey.values()) {
		bucket.sort((a, b) => a.id.localeCompare(b.id));
	}

	const resolvedId = new Map<string, string>();
	const matchedProposedIds = new Set<string>();
	const consumedObservedIds = new Set<string>();

	for (const node of proposed) {
		const direct = observedById.get(node.id);
		if (direct && !consumedObservedIds.has(direct.id)) {
			resolvedId.set(node.id, direct.id);
			matchedProposedIds.add(node.id);
			consumedObservedIds.add(direct.id);
			continue;
		}

		const candidate = observedByKey.get(nodeIdentityKey(node))?.find((candidate) => !consumedObservedIds.has(candidate.id));
		if (candidate) {
			resolvedId.set(node.id, candidate.id);
			matchedProposedIds.add(node.id);
			consumedObservedIds.add(candidate.id);
		} else {
			resolvedId.set(node.id, node.id);
		}
	}

	return { resolvedId, matchedProposedIds };
}

export interface EdgeMatchResult {
	/** `proposed` edges with their endpoints resolved through `resolvedNodeId`, so an edge to/from a matched node points at the observed node's id instead of the proposed one. */
	resolvedEdges: GraphEdge[];
	/** Proposed edge id -> the observed edge id it matched. */
	matchedProposedEdgeIds: Map<string, string>;
}

/**
 * Matches each `proposed` edge (after resolving its endpoints through
 * `resolvedNodeId`, see `matchNodes`) against an `observed` edge of the same
 * kind connecting the same two (resolved) node ids. An edge between two
 * nodes that didn't themselves match can never match here, since its
 * resolved endpoints stay proposed-only ids no observed edge references.
 */
export function matchEdges(observed: GraphEdge[], proposed: GraphEdge[], resolvedNodeId: Map<string, string>): EdgeMatchResult {
	const observedByKey = new Map<string, GraphEdge>();
	for (const edge of observed) {
		observedByKey.set(edgeIdentityKey(edge.kind, edge.source, edge.target), edge);
	}

	const resolvedEdges: GraphEdge[] = [];
	const matchedProposedEdgeIds = new Map<string, string>();

	for (const edge of proposed) {
		const source = resolvedNodeId.get(edge.source) ?? edge.source;
		const target = resolvedNodeId.get(edge.target) ?? edge.target;
		resolvedEdges.push({ ...edge, source, target });

		const match = observedByKey.get(edgeIdentityKey(edge.kind, source, target));
		if (match) {
			matchedProposedEdgeIds.set(edge.id, match.id);
		}
	}

	return { resolvedEdges, matchedProposedEdgeIds };
}

export interface GraphComparisonSummary {
	matchedNodeCount: number;
	proposedOnlyNodeCount: number;
	matchedEdgeCount: number;
	proposedOnlyEdgeCount: number;
}

/**
 * Applies `matchNodes`/`matchEdges` to `store`: every node/edge the
 * comparison matched is annotated `matched` on its existing (observed) row,
 * and every proposed node/edge left over is upserted as `proposed_only`,
 * with its endpoints resolved to whatever matched so the graph never ends up
 * with a dangling edge to an id that only ever existed in the proposal.
 *
 * Any node/edge left `matched` from a previous call is reset to
 * `observed_only` first, so re-running this (e.g. a second "Design Project"
 * pass) recomputes the comparison from scratch against the latest proposal
 * instead of accumulating stale matches. This never touches the *content* of
 * an observed row — only its status — so a match never clobbers data the
 * extraction pipelines actually found in the code.
 */
export function reconcileProposedGraph(store: ProjectGraphStore, proposed: CodeGraph): GraphComparisonSummary {
	for (const node of store.listNodes({ status: 'matched' })) {
		store.setNodeStatus(node.id, 'observed_only');
	}
	for (const edge of store.listEdges({ status: 'matched' })) {
		store.setEdgeStatus(edge.id, 'observed_only');
	}
	store.clearByStatus('proposed_only');

	const observedNodes = store.listNodes({ status: 'observed_only' });
	const observedEdges = store.listEdges({ status: 'observed_only' });

	const { resolvedId, matchedProposedIds } = matchNodes(observedNodes, proposed.nodes);
	const { resolvedEdges, matchedProposedEdgeIds } = matchEdges(observedEdges, proposed.edges, resolvedId);

	for (const node of proposed.nodes) {
		if (matchedProposedIds.has(node.id)) {
			store.setNodeStatus(resolvedId.get(node.id) as string, 'matched');
		} else {
			store.upsertNode(node, 'proposed_only');
		}
	}

	for (const edge of resolvedEdges) {
		const matchedObservedEdgeId = matchedProposedEdgeIds.get(edge.id);
		if (matchedObservedEdgeId) {
			store.setEdgeStatus(matchedObservedEdgeId, 'matched');
		} else {
			store.upsertEdge(edge, 'proposed_only');
		}
	}

	return {
		matchedNodeCount: matchedProposedIds.size,
		proposedOnlyNodeCount: proposed.nodes.length - matchedProposedIds.size,
		matchedEdgeCount: matchedProposedEdgeIds.size,
		proposedOnlyEdgeCount: proposed.edges.length - matchedProposedEdgeIds.size
	};
}
