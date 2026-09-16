// The Project Graph's visual panel. Owns only the panel lifecycle and the
// postMessage bridge (contract in `./webview/protocol`); the actual
// node/edge data comes from `ProjectGraphStore`, collapsed to the workflow-
// relevant hierarchy by `filterGraphForWorkflow`, and rendering/navigation
// (hierarchical layout, focus, progressive expansion) happens entirely in
// the webview script (`./webview/App.tsx`).
import * as vscode from 'vscode';
import { ProjectGraphStore } from '../core/store';
import { filterGraphForWorkflow } from './graphFilter';
import { findInitialFocusNodeId } from './graphFocus';
import { HostToWebviewMessage, WebviewToHostMessage } from './webview/protocol';

const VIEW_TYPE = 'agentGraph.graphView';
const VIEW_TITLE = 'Project Graph';

/** Paths, relative to the extension root, of the esbuild-bundled webview script and stylesheet (see esbuild.js). esbuild emits `main.css` alongside `main.js` automatically because `main.tsx` imports CSS. */
const WEBVIEW_SCRIPT_PATH = ['dist', 'ui', 'webview', 'main.js'];
const WEBVIEW_STYLE_PATH = ['dist', 'ui', 'webview', 'main.css'];

/**
 * Single React Flow webview panel for the workspace's Project Graph.
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

	/** Syncs the currently open graph panel's selection to `nodeId`, e.g. when a tree item is clicked. No-op when no panel is open. */
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
	 * is resolved from the *current* active editor at each of those moments
	 * (both are, in effect, "opening the view"), against the
	 * already workflow-filtered graph so it always names a node the webview
	 * actually has.
	 */
	private postGraph(): void {
		const graph = filterGraphForWorkflow(this.store.getGraph());
		const update: HostToWebviewMessage = {
			type: 'graph:update',
			graph,
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
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...WEBVIEW_STYLE_PATH));
		const nonce = getNonce();
		const csp = [
			`default-src 'none'`,
			`style-src 'unsafe-inline' ${webview.cspSource}`,
			`img-src ${webview.cspSource} data:`,
			`font-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>${VIEW_TITLE}</title>
</head>
<body>
	<div id="root"></div>
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
