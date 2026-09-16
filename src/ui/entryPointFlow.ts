// Host-side data prep for the "Show Entry Point Flow" view (./entryPointFlowPanel):
// lists the entry points Epic M's ../core/entryPoints already detects, so a
// caller (the command's own picker, or the view's own entry-point selector)
// can offer them, and builds the chosen one's call flow via
// ../core/entryPointFlow. Kept free of any vscode dependency, like
// ./architectureLayers and ./sequenceDiagram, so it can be unit tested
// directly.
import { detectEntryPoints, EntryPoint } from '../core/entryPoints';
import { buildEntryPointFlow, EntryPointFlow } from '../core/entryPointFlow';
import { ProjectGraphStore, StoredGraph } from '../core/store';

export const SHOW_ENTRY_POINT_FLOW_COMMAND = 'agentGraph.showEntryPointFlow';

export interface EntryPointFlowViewData {
	entryPoints: EntryPoint[];
	selectedEntryPointId: string;
	flow: EntryPointFlow;
}

/**
 * `entryPoints`, `selectedEntryPointId`'s flow, or `undefined` when
 * `selectedEntryPointId` is no longer a node in `graph` (e.g. the Project
 * Graph was re-analyzed and that symbol is gone) — the panel falls back to
 * an empty state in that case rather than showing a stale flow.
 */
export function buildEntryPointFlowViewData(store: ProjectGraphStore, graph: StoredGraph, selectedEntryPointId: string): EntryPointFlowViewData | undefined {
	const flow = buildEntryPointFlow(graph, selectedEntryPointId);
	if (!flow) {
		return undefined;
	}
	return { entryPoints: detectEntryPoints(store), selectedEntryPointId, flow };
}
