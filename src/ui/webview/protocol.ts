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

/** One folder group's own member files, computed on demand (`architecture:requestFiles` below) when the user expands that group, rather than upfront for every group — the webview merges these in as the group's children rather than navigating to a separate screen. */
export interface ArchitectureFilesPayload {
	groupId: string;
	model: DiagramModel;
	entryPointFileIds: string[];
}

export type ExportFormat = 'svg' | 'png' | 'pdf';

/** The webview's current level in the "Open Architecture" panel, sent along with `graph:exportRequest` so the host can build a Markdown export that matches whatever's actually on screen, without tracking that navigation state itself. */
export type GraphExportView =
	| { level: 'layers'; /** Ids of the folder groups currently expanded (their member files merged onto the canvas) — the host reproduces the same merge for the Markdown export. */ expandedGroupIds: string[] }
	| { level: 'symbols'; focusNodeId: string; expandedNodeIds: string[] };

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
	  }
	| {
			/** Sent after the host's save dialog picked an `svg`/`png`/`pdf` destination for `graph:exportRequest` — the webview replies with `graph:exportCaptured`/`graph:exportCaptureFailed`. */
			type: 'graph:exportCapture';
			format: ExportFormat;
	  };

export type WebviewToHostMessage =
	| { type: 'graph:ready' }
	| { type: 'architecture:requestFiles'; groupId: string }
	| {
			/** A file card in the layers view was clicked (either a root-level file or one revealed by expanding its folder) — opens the Entry Point Flow view (a separate panel) for that file's call relationships instead of drilling into the old per-file symbol level. */
			type: 'architecture:openFileFlow';
			fileId: string;
	  }
	| { type: 'graph:exportRequest'; view: GraphExportView }
	| { type: 'graph:exportCaptured'; format: ExportFormat; payload: string; width: number; height: number }
	| { type: 'graph:exportCaptureFailed' };
