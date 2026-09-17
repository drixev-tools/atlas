// The `postMessage` contract between the extension host (../activeFileFlowPanel.ts)
// and this webview (./ActiveFileFlowApp.tsx) — the same webview bundle as
// ./App.tsx's, rendering a different root component (see ./main.tsx), so
// this stays its own small contract rather than growing ./protocol.ts's.
import { StoredEdge, StoredNode } from '../../core/store';

/** ../../core/activeFileFlow's `ActiveFileFlow`, with its `Set` fields converted to plain arrays for `postMessage`. */
export interface ActiveFileFlowPayload {
	activeFileId: string;
	nodes: StoredNode[];
	edges: StoredEdge[];
	highlightedIds: string[];
	rootIds: string[];
}

export type ActiveFileFlowExportFormat = 'svg' | 'png' | 'pdf';

export type ActiveFileFlowHostToWebviewMessage =
	| { type: 'activeFileFlow:update'; activeFilePath: string; flow: ActiveFileFlowPayload }
	| { type: 'activeFileFlow:empty'; message: string }
	| { type: 'activeFileFlow:exportCapture'; format: ActiveFileFlowExportFormat };

export type ActiveFileFlowWebviewToHostMessage =
	| { type: 'activeFileFlow:ready' }
	| { type: 'activeFileFlow:openNode'; nodeId: string }
	| { type: 'activeFileFlow:exportRequest' }
	| { type: 'activeFileFlow:exportCaptured'; format: ActiveFileFlowExportFormat; payload: string; width: number; height: number }
	| { type: 'activeFileFlow:exportCaptureFailed' };
