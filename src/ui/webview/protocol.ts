// The `postMessage` contract between the extension host (`../graphPanel.ts`)
// and this webview (`./App.tsx`). Defined once, in a module neither side
// needs anything else from (`StoredGraph`/`DiagramModel` themselves have no
// `vscode` or React dependency), so both the Node-platform extension bundle
// and the browser-platform webview bundle can import it without pulling the
// other's runtime along.
import { DiagramModel } from '../../core/diagramModel';
import { StoredGraph } from '../../core/store';

export interface ArchitectureLayerLabel {
	label: string;
	description: string;
	aiGenerated: boolean;
}

/** The architecture view's default "layers" level: the folder/module-aggregated `DiagramModel` (../../core/moduleAggregation), plus each group's display label and whether it holds a detected entry point. */
export interface ArchitectureLayerPayload {
	model: DiagramModel;
	labelsByGroupId: Record<string, ArchitectureLayerLabel>;
	entryPointGroupIds: string[];
}

/** One group's "files" drill-down level, computed on demand (`architecture:requestFiles` below) rather than upfront for every group. */
export interface ArchitectureFilesPayload {
	groupId: string;
	model: DiagramModel;
	entryPointFileIds: string[];
}

export type HostToWebviewMessage =
	| {
			type: 'graph:update';
			graph: StoredGraph;
			/** The node to focus by default, e.g. the active editor's file. The webview shows only this node's direct relations until the user expands further; `undefined` falls back to rendering nothing (no file node to anchor on, e.g. an empty workspace). */
			focusNodeId: string | undefined;
			architecture: ArchitectureLayerPayload;
	  }
	| {
			/** Re-focuses the symbol-level view on one node without waiting for a fresh `graph:update`, and switches the view to that level if it was showing the layers/files levels instead. No-op in the webview if `nodeId` isn't in the currently loaded graph. */
			type: 'graph:select';
			nodeId: string;
	  }
	| {
			/** A follow-up label upgrade for whichever groups `graph:update`'s `architecture.labelsByGroupId` sent with a folder-name (or stale) fallback — sent once Claude actually responds, so the initial render never waits on it. */
			type: 'architecture:labels';
			labelsByGroupId: Record<string, ArchitectureLayerLabel>;
	  }
	| {
			type: 'architecture:files';
			payload: ArchitectureFilesPayload;
	  };

export type WebviewToHostMessage =
	| { type: 'graph:ready' }
	| { type: 'architecture:requestFiles'; groupId: string };
