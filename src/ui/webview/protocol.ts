// The `postMessage` contract between the extension host (`../graphPanel.ts`)
// and this webview (`./App.tsx`) — reused as-is from the Cytoscape.js
// version retired in Fase 1.2, Epic D (see that commit's `graphPanel.ts`),
// just with `elements: cytoscape.ElementDefinition[]` swapped for the
// already workflow-filtered (Epic E) `StoredGraph` React Flow renders
// directly. Defined once, in a module neither side needs anything else from
// (`StoredGraph` itself has no `vscode` or React dependency), so both the
// Node-platform extension bundle and the browser-platform webview bundle can
// import it without pulling the other's runtime along.
import { StoredGraph } from '../../core/store';

export type HostToWebviewMessage =
	| {
			type: 'graph:update';
			graph: StoredGraph;
			/** The node to focus by default, e.g. the active editor's file. The webview shows only this node's direct relations until the user expands further; `undefined` falls back to rendering nothing (no file node to anchor on, e.g. an empty workspace). */
			focusNodeId: string | undefined;
	  }
	| {
			/** Sidebar Panel (Fase 1.1, Epic A task 3): re-focuses the view on one node — its direct relations only — without waiting for a fresh `graph:update`. No-op in the webview if `nodeId` isn't in the currently loaded graph. */
			type: 'graph:select';
			nodeId: string;
	  };

export type WebviewToHostMessage = {
	type: 'graph:ready';
};
