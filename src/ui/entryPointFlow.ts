// Host-side data prep for the "Show Entry Point Flow" view (./entryPointFlowPanel):
// lists the entry points Epic M's ../core/entryPoints already detects, so a
// caller (the command's own picker, or the view's own entry-point selector)
// can offer them, and builds the chosen one's call flow via
// ../core/entryPointFlow. Kept free of any vscode dependency, like
// ./architectureLayers and ./sequenceDiagram, so it can be unit tested
// directly.
import { detectEntryPoints, EntryPoint } from '../core/entryPoints';
import { buildEntryPointFlow, EntryPointFlow } from '../core/entryPointFlow';
import { ProjectGraphStore, StoredGraph, StoredNode } from '../core/store';

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

function isFunctionLike(node: StoredNode): boolean {
	return node.kind === 'function' || node.kind === 'method';
}

/**
 * Picks the node a file's card should open the Entry Point Flow view on
 * (../graphPanel's `architecture:openFileFlow`, replacing the old
 * file-focused symbol drill-down): `fileId`'s own detected entry point if it
 * has one, otherwise whichever function/method declared in that file makes
 * the most outgoing `calls` (the closest thing to "what this file does" when
 * no framework-recognized entry point applies), breaking ties by declaration
 * order. `undefined` when `fileId` isn't a file node or declares no
 * functions/methods at all — there's nothing to trace.
 */
export function resolveFileFlowEntryPointId(store: ProjectGraphStore, graph: StoredGraph, fileId: string): string | undefined {
	const file = graph.nodes.find((node) => node.id === fileId);
	if (!file || file.kind !== 'file' || !file.filePath) {
		return undefined;
	}

	const functionsInFile = graph.nodes.filter((node) => node.filePath === file.filePath && isFunctionLike(node));
	if (functionsInFile.length === 0) {
		return undefined;
	}

	const entryPointInFile = detectEntryPoints(store).find((entryPoint) => entryPoint.filePath === file.filePath);
	if (entryPointInFile) {
		return entryPointInFile.nodeId;
	}

	const outgoingCallCountById = new Map<string, number>();
	for (const edge of graph.edges) {
		if (edge.kind === 'calls') {
			outgoingCallCountById.set(edge.source, (outgoingCallCountById.get(edge.source) ?? 0) + 1);
		}
	}

	return functionsInFile.reduce((best, candidate) =>
		(outgoingCallCountById.get(candidate.id) ?? 0) > (outgoingCallCountById.get(best.id) ?? 0) ? candidate : best
	).id;
}
