// Host-side data prep for the "Active File Flow" view (./activeFileFlowPanel):
// resolves the active editor's file path to its Project Graph node id and
// builds its flow via ../core/activeFileFlow. Kept free of any vscode
// dependency, like ./architectureLayers and ./sequenceDiagram, so it can be
// unit tested directly.
import * as path from 'path';
import { ActiveFileFlow, buildActiveFileFlow } from '../core/activeFileFlow';
import { StoredGraph } from '../core/store';

export const SHOW_ACTIVE_FILE_FLOW_COMMAND = 'atlas.showActiveFileFlow';

export interface ActiveFileFlowViewData {
	flow: ActiveFileFlow;
}

/** `graph`'s file node for `filePath`, matched by resolved path like every other file-lookup in this codebase (../core/impact's `fileNodeId`). */
export function resolveActiveFileId(graph: StoredGraph, filePath: string): string | undefined {
	const resolved = path.resolve(filePath);
	return graph.nodes.find((node) => node.kind === 'file' && node.filePath && path.resolve(node.filePath) === resolved)?.id;
}

/**
 * `activeFilePath`'s flow, or `undefined` when it isn't a file the Project
 * Graph knows about (not analyzed yet, or outside the workspace) — the panel
 * falls back to an empty state in that case.
 */
export function buildActiveFileFlowViewData(graph: StoredGraph, activeFilePath: string): ActiveFileFlowViewData | undefined {
	const fileId = resolveActiveFileId(graph, activeFilePath);
	if (!fileId) {
		return undefined;
	}
	const flow = buildActiveFileFlow(graph, fileId);
	return flow ? { flow } : undefined;
}
