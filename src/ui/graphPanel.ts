import * as vscode from 'vscode';
import { ProjectGraphStore } from '../core/store';
import { toCytoscapeElements } from './graphData';

const VIEW_TYPE = 'agentGraph.graphView';
const VIEW_TITLE = 'Project Graph';

/** Path, relative to the extension root, of the esbuild-bundled webview script (see esbuild.js). */
const WEBVIEW_SCRIPT_PATH = ['dist', 'ui', 'webview', 'main.js'];

type HostToWebviewMessage = {
	type: 'graph:update';
	elements: unknown[];
};

type WebviewToHostMessage = {
	type: 'graph:ready';
};

/**
 * Single Cytoscape.js webview panel for the workspace's Project Graph. Owns
 * only the panel lifecycle and the postMessage bridge; the actual node/edge
 * data comes from `ProjectGraphStore` (Epic 4/5) via `toCytoscapeElements`,
 * and rendering/navigation (zoom, selection, neighbor highlighting) happens
 * entirely in the webview script (`ui/webview/main.ts`).
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

	/** Sent on webview load (`graph:ready`) and whenever the panel is re-shown with a fresh store, e.g. via the command being run again. */
	private postGraph(): void {
		const update: HostToWebviewMessage = {
			type: 'graph:update',
			elements: toCytoscapeElements(this.store.getGraph())
		};
		void this.panel.webview.postMessage(update);
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
