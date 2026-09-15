import * as vscode from 'vscode';
import { ProjectGraphStore } from '../core/store';
import { findInitialFocusNodeId, toCytoscapeElements } from './graphData';

export const OPEN_ARCHITECTURE_COMMAND = 'agentGraph.openArchitecture';

const VIEW_TYPE = 'agentGraph.graphView';
const VIEW_TITLE = 'Project Graph';

/** Path, relative to the extension root, of the esbuild-bundled webview script (see esbuild.js). */
const WEBVIEW_SCRIPT_PATH = ['dist', 'ui', 'webview', 'main.js'];

type HostToWebviewMessage =
	| {
			type: 'graph:update';
			elements: unknown[];
			/** Rediseño de visualización (Fase 1.1, Epic B, task 7): the node to focus by default, e.g. the active editor's file. The webview shows only this node's direct relations (task 4) until the user expands further; `undefined` falls back to rendering the whole graph (no file node to anchor on, e.g. an empty workspace). */
			focusNodeId: string | undefined;
	  }
	| {
			/** Sidebar Panel (Fase 1.1, Epic A, task 3): re-focuses the view on one node — its direct relations only (Epic B tasks 3-4) — without waiting for a fresh `graph:update`. No-op in the webview if `nodeId` isn't in the currently loaded graph. */
			type: 'graph:select';
			nodeId: string;
	  };

type WebviewToHostMessage = {
	type: 'graph:ready';
};

/**
 * Single Cytoscape.js webview panel for the workspace's Project Graph. Owns
 * only the panel lifecycle and the postMessage bridge; the actual node/edge
 * data comes from `ProjectGraphStore` (Epic 4/5) via `toCytoscapeElements`,
 * and rendering/navigation (hierarchical layout, focus, progressive
 * expansion, the side detail panel — Epic B) happens entirely in the webview
 * script (`ui/webview/main.ts`).
 */
export class GraphPanel implements vscode.Disposable {
	private static current: GraphPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly extensionUri: vscode.Uri,
		private store: ProjectGraphStore
	) {
		this.panel.webview.html = this.renderHtml();
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			(message: WebviewToHostMessage) => this.handleMessage(message),
			null,
			this.disposables
		);
	}

	/** Opens the graph view, or reveals and refreshes the existing one if it's already open. Takes ownership of `store` (closes it on dispose/replacement). */
	static createOrShow(extensionUri: vscode.Uri, store: ProjectGraphStore): GraphPanel {
		const column = vscode.window.activeTextEditor?.viewColumn;

		if (GraphPanel.current) {
			GraphPanel.current.panel.reveal(column);
			GraphPanel.current.replaceStore(store);
			return GraphPanel.current;
		}

		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, VIEW_TITLE, column ?? vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'ui', 'webview')]
		});

		GraphPanel.current = new GraphPanel(panel, extensionUri, store);
		return GraphPanel.current;
	}

	/** Syncs the currently open graph panel's selection to `nodeId` (Sidebar Panel, Epic A task 3), e.g. when a tree item is clicked. No-op when no panel is open. */
	static selectNode(nodeId: string): void {
		GraphPanel.current?.postSelect(nodeId);
	}

	get webview(): vscode.Webview {
		return this.panel.webview;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		GraphPanel.current = undefined;
		this.store.close();
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.panel.dispose();
	}

	private replaceStore(store: ProjectGraphStore): void {
		if (store !== this.store) {
			this.store.close();
		}
		this.store = store;
		this.postGraph();
	}

	private handleMessage(message: WebviewToHostMessage): void {
		if (message?.type === 'graph:ready') {
			this.postGraph();
		}
	}

	/**
	 * Sent on webview load (`graph:ready`) and whenever the panel is re-shown
	 * with a fresh store, e.g. via the command being run again. `focusNodeId`
	 * (Epic B, task 7) is resolved from the *current* active editor at each of
	 * those moments — both are, in effect, "opening the view".
	 */
	private postGraph(): void {
		const graph = this.store.getGraph();
		const update: HostToWebviewMessage = {
			type: 'graph:update',
			elements: toCytoscapeElements(graph),
			focusNodeId: findInitialFocusNodeId(graph, vscode.window.activeTextEditor?.document.uri.fsPath)
		};
		void this.panel.webview.postMessage(update);
	}

	private postSelect(nodeId: string): void {
		const select: HostToWebviewMessage = { type: 'graph:select', nodeId };
		void this.panel.webview.postMessage(select);
	}

	private renderHtml(): string {
		const webview = this.panel.webview;
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...WEBVIEW_SCRIPT_PATH));
		const nonce = getNonce();
		const csp = [
			`default-src 'none'`,
			`style-src 'unsafe-inline' ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${VIEW_TITLE}</title>
	<style>
		html, body {
			margin: 0;
			padding: 0;
			width: 100%;
			height: 100%;
			overflow: hidden;
			background: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family);
		}
		#cy {
			position: absolute;
			inset: 0;
		}
		#empty-state {
			position: absolute;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			opacity: 0.7;
			text-align: center;
		}
		#status-legend {
			position: absolute;
			bottom: 8px;
			left: 8px;
			font-size: 11px;
			opacity: 0.85;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}
		#status-legend .swatch {
			display: inline-block;
			width: 10px;
			height: 10px;
			margin-right: 6px;
			border-radius: 2px;
			vertical-align: middle;
		}
		#detail-panel {
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			width: 260px;
			overflow-y: auto;
			box-sizing: border-box;
			padding: 12px;
			background: var(--vscode-sideBar-background, var(--vscode-editor-background));
			border-left: 1px solid var(--vscode-panel-border, transparent);
			font-size: 12px;
		}
		#detail-header {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 8px;
			margin-bottom: 8px;
		}
		#detail-title {
			font-weight: 600;
			word-break: break-word;
		}
		#detail-close {
			background: none;
			border: none;
			color: inherit;
			cursor: pointer;
			font-size: 14px;
			line-height: 1;
			padding: 0;
			opacity: 0.7;
		}
		#detail-close:hover {
			opacity: 1;
		}
		#detail-fields {
			margin: 0;
		}
		#detail-fields dt {
			opacity: 0.7;
			margin-top: 8px;
		}
		#detail-fields dd {
			margin: 0;
			word-break: break-word;
		}
	</style>
</head>
<body>
	<div id="cy"></div>
	<div id="empty-state" hidden>No nodes to display yet. Run "Project Graph: Analyze Workspace" first.</div>
	<div id="status-legend">
		<span><span class="swatch" style="background:#4a90d9;"></span>Observed</span>
		<span><span class="swatch" style="background:#4a90d9;border:2px dashed #b18cf2;"></span>Proposed only</span>
		<span><span class="swatch" style="background:#4a90d9;border:2px solid #4caf50;"></span>Matched</span>
	</div>
	<div id="detail-panel" hidden>
		<div id="detail-header">
			<span id="detail-title"></span>
			<button id="detail-close" aria-label="Close details" title="Close">&times;</button>
		</div>
		<dl id="detail-fields"></dl>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
