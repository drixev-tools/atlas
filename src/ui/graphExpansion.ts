// Pure helpers behind the graph webview's default-collapsed, progressively
// expanded view (Fase 1.1, Epic B, tasks 3-5): given the *full* set of
// Cytoscape elements the host sends over `graph:update`, compute which
// subset should actually be rendered for a given focused node plus whichever
// other nodes the user has expanded by clicking. Kept free of any live
// `cytoscape.Core`/webview dependency (only the element *data* shape is
// used) so it can be unit tested directly, the same way `graphData.ts` is.
// `ui/webview/main.ts` is the only caller; it owns the actual render/click
// wiring and the resulting selection/expansion state.
import type cytoscape from 'cytoscape';

export type GraphElement = cytoscape.ElementDefinition;

function isNodeElement(element: GraphElement): boolean {
	return element.group === 'nodes';
}

function isEdgeElement(element: GraphElement): boolean {
	return element.group === 'edges';
}

/**
 * Task 3 — the criterion for a node's "direct relations": every edge with
 * `nodeId` as its source or target, of any kind (`contains`, `imports`,
 * `exports` alike, in either direction), plus the node at the other end of
 * each. I.e. `nodeId`'s one-hop neighborhood over the whole graph.
 */
export function directRelationIds(elements: GraphElement[], nodeId: string): { nodeIds: Set<string>; edgeIds: Set<string> } {
	const nodeIds = new Set<string>([nodeId]);
	const edgeIds = new Set<string>();
	for (const element of elements) {
		if (!isEdgeElement(element)) {
			continue;
		}
		const source = element.data.source as string;
		const target = element.data.target as string;
		if (source === nodeId || target === nodeId) {
			edgeIds.add(element.data.id as string);
			nodeIds.add(source === nodeId ? target : source);
		}
	}
	return { nodeIds, edgeIds };
}

/**
 * Tasks 4-5 — the elements actually shown on canvas: the focused node's own
 * direct relations (the default view, before anything is expanded) plus the
 * direct relations of every other node the user has expanded by clicking it.
 * Recomputed from scratch on every toggle rather than incrementally patched,
 * so collapsing one expanded node correctly keeps a neighbor visible when
 * another expanded node (or the focus itself) still needs it.
 */
export function visibleElements(elements: GraphElement[], focusNodeId: string, expandedNodeIds: ReadonlySet<string>): GraphElement[] {
	const nodeIds = new Set<string>();
	const edgeIds = new Set<string>();
	for (const id of new Set([focusNodeId, ...expandedNodeIds])) {
		const relations = directRelationIds(elements, id);
		for (const nid of relations.nodeIds) {
			nodeIds.add(nid);
		}
		for (const eid of relations.edgeIds) {
			edgeIds.add(eid);
		}
	}
	return elements.filter((element) =>
		isNodeElement(element) ? nodeIds.has(element.data.id as string) : edgeIds.has(element.data.id as string)
	);
}

/** Incoming/outgoing edge counts for `nodeId` over the *full* element set, shown in the side detail panel (task 6) regardless of how much of the graph is currently expanded. */
export function countEdges(elements: GraphElement[], nodeId: string): { incoming: number; outgoing: number } {
	let incoming = 0;
	let outgoing = 0;
	for (const element of elements) {
		if (!isEdgeElement(element)) {
			continue;
		}
		if (element.data.source === nodeId) {
			outgoing++;
		}
		if (element.data.target === nodeId) {
			incoming++;
		}
	}
	return { incoming, outgoing };
}
