// Pure helpers behind the flow view's default-collapsed, progressively
// expanded rendering (./webview/EntryPointFlowApp.tsx): given the *whole*
// depth-bounded flow ../core/entryPointFlow already computed, decide which
// subset is actually shown for a given set of user-expanded nodes. Mirrors
// ./graphExpansion's role for the symbol-level workflow view, just walking
// outward from a single entry point along `calls` edges instead of every
// edge in both directions from a focus node.
import { EntryPointFlow } from '../core/entryPointFlow';

/** The ids `calls` edges reach directly from `nodeId` within `flow`. */
export function childIds(flow: EntryPointFlow, nodeId: string): string[] {
	return flow.edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target);
}

export interface VisibleEntryPointFlow {
	nodeIds: Set<string>;
	edgeIds: Set<string>;
}

/**
 * The subset of `flow` actually shown on canvas: the entry point itself,
 * its direct callees (shown by default, the same way the symbol-level view
 * always shows a focus node's direct relations), plus the direct callees of
 * every other node in `expandedNodeIds`. Computed as a fixed point over
 * `flow.edges` rather than a single BFS pass so a node reachable through more
 * than one expanded ancestor still only needs one of them expanded to appear.
 */
export function visibleEntryPointFlow(flow: EntryPointFlow, expandedNodeIds: ReadonlySet<string>): VisibleEntryPointFlow {
	const alwaysExpanded = new Set([flow.entryPointId, ...expandedNodeIds]);
	const nodeIds = new Set<string>([flow.entryPointId]);
	const edgeIds = new Set<string>();

	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of flow.edges) {
			if (!nodeIds.has(edge.source) || !alwaysExpanded.has(edge.source)) {
				continue;
			}
			if (!nodeIds.has(edge.target)) {
				nodeIds.add(edge.target);
				changed = true;
			}
			if (!edgeIds.has(edge.id)) {
				edgeIds.add(edge.id);
				changed = true;
			}
		}
	}

	return { nodeIds, edgeIds };
}

/** Whether `nodeId` has a callee not currently visible — the flow view's cue that it can still be expanded further. */
export function hasCollapsedChildren(flow: EntryPointFlow, nodeId: string, visibleNodeIds: ReadonlySet<string>): boolean {
	return childIds(flow, nodeId).some((id) => !visibleNodeIds.has(id));
}
