// The `postMessage` contract between the extension host (../entryPointFlowPanel.ts)
// and this webview (./EntryPointFlowApp.tsx) — the same webview bundle as
// ./App.tsx's, rendering a different root component (see ./main.tsx), so
// this stays its own small contract rather than growing ./protocol.ts's.
import { EntryPoint } from '../../core/entryPoints';
import { StoredEdge, StoredNode } from '../../core/store';

/** ../../core/entryPointFlow's `EntryPointFlow`, with its `Map`/`Set` fields converted to plain JSON for `postMessage`. */
export interface EntryPointFlowPayload {
	entryPointId: string;
	nodes: StoredNode[];
	edges: StoredEdge[];
	depthById: Record<string, number>;
	truncatedNodeIds: string[];
}

export type EntryPointFlowExportFormat = 'svg' | 'png' | 'pdf';

export type EntryPointFlowHostToWebviewMessage =
	| { type: 'entryPointFlow:update'; entryPoints: EntryPoint[]; selectedEntryPointId: string; flow: EntryPointFlowPayload }
	| { type: 'entryPointFlow:empty'; entryPoints: EntryPoint[] }
	| { type: 'entryPointFlow:exportCapture'; format: EntryPointFlowExportFormat };

export type EntryPointFlowWebviewToHostMessage =
	| { type: 'entryPointFlow:ready' }
	| { type: 'entryPointFlow:selectEntryPoint'; nodeId: string }
	| { type: 'entryPointFlow:openNode'; nodeId: string }
	| { type: 'entryPointFlow:exportRequest'; expandedNodeIds: string[] }
	| { type: 'entryPointFlow:exportCaptured'; format: EntryPointFlowExportFormat; payload: string; width: number; height: number }
	| { type: 'entryPointFlow:exportCaptureFailed' };
