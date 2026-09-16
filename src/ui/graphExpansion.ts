// Pure helpers behind the graph webview's default-collapsed, progressively
// expanded view: given the *full* workflow-relevant graph the host sends
// over `graph:update` (already collapsed by `filterGraphForWorkflow`),
// compute which subset should actually be rendered for a given focused node
// plus whichever other nodes the user has expanded by clicking. Kept free of
// any React/webview dependency so it can be unit tested directly, the same
// way `graphFilter.ts` is. `ui/webview/App.tsx` is the only caller; it owns
// the actual render/click wiring and the resulting selection/expansion
// state.
import { StoredGraph } from '../core/store';

/**
 * The criterion for a node's "direct relations": every edge with `nodeId` as
 * its source or target, of any kind, in either direction, plus the node at
 * the other end of each. I.e. `nodeId`'s one-hop neighborhood over the whole
 * (already workflow-filtered) graph.
 */
export function directRelationIds(graph: StoredGraph, nodeId: string): { nodeIds: Set<string>; edgeIds: Set<string> } {
	const nodeIds = new Set<string>([nodeId]);
	const edgeIds = new Set<string>();
	for (const edge of graph.edges) {
		if (edge.source === nodeId || edge.target === nodeId) {
			edgeIds.add(edge.id);
			nodeIds.add(edge.source === nodeId ? edge.target : edge.source);
		}
	}
	return { nodeIds, edgeIds };
}

/**
 * The subgraph actually shown on canvas: the focused node's own direct
 * relations (the default view, before anything is expanded) plus the direct
 * relations of every other node the user has expanded by clicking it.
 * Recomputed from scratch on every toggle rather than incrementally patched,
 * so collapsing one expanded node correctly keeps a neighbor visible when
 * another expanded node (or the focus itself) still needs it.
 */
export function visibleGraph(graph: StoredGraph, focusNodeId: string, expandedNodeIds: ReadonlySet<string>): StoredGraph {
	const nodeIds = new Set<string>();
	const edgeIds = new Set<string>();
	for (const id of new Set([focusNodeId, ...expandedNodeIds])) {
		const relations = directRelationIds(graph, id);
		for (const nid of relations.nodeIds) {
			nodeIds.add(nid);
		}
		for (const eid of relations.edgeIds) {
			edgeIds.add(eid);
		}
	}
	return {
		nodes: graph.nodes.filter((node) => nodeIds.has(node.id)),
		edges: graph.edges.filter((edge) => edgeIds.has(edge.id))
	};
}

/** Incoming/outgoing edge counts for `nodeId` over the *full* graph, shown next to a node regardless of how much of it is currently expanded — a hint that there's more to reveal. */
export function countEdges(graph: StoredGraph, nodeId: string): { incoming: number; outgoing: number } {
	let incoming = 0;
	let outgoing = 0;
	for (const edge of graph.edges) {
		if (edge.source === nodeId) {
			outgoing++;
		}
		if (edge.target === nodeId) {
			incoming++;
		}
	}
	return { incoming, outgoing };
}
