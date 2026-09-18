// The active-file flow view's panel lifecycle and postMessage bridge
// (contract in ./webview/activeFileFlowProtocol) — mirrors ./graphPanel's
// singleton create-or-reveal shape, but as its own `WebviewPanel` (a
// different diagram entirely from the Project Graph/Architecture view, not
// another mode of it) loading the same bundled React Flow script
// (./webview/main.tsx picks the root component via `data-view`). There's no
// picker: it tracks `vscode.window.onDidChangeActiveTextEditor` itself and
// rebuilds the flow (../core/activeFileFlow via ./activeFileFlow) for
// whichever file is open, for as long as the panel stays open.
import * as vscode from 'vscode';
import { buildDiagramModel } from '../core/diagramModel';
import { diagramModelToMermaidFlowchart, toMermaidMarkdown } from '../core/diagramMermaid';
import { ActiveFileFlow } from '../core/activeFileFlow';
import { ProjectGraphStore } from '../core/store';
import { buildActiveFileFlowViewData } from './activeFileFlow';
import { ExportDestination, pickExportDestination, writeMarkdownExport, writePdfExportFromJpeg, writePngExport, writeSvgExport } from './diagramExport';
import { ActiveFileFlowHostToWebviewMessage, ActiveFileFlowPayload, ActiveFileFlowWebviewToHostMessage } from './webview/activeFileFlowProtocol';

const VIEW_TYPE = 'atlas.activeFileFlowView';
const VIEW_TITLE = 'Active File Flow';

const WEBVIEW_SCRIPT_PATH = ['dist', 'ui', 'webview', 'main.js'];
const WEBVIEW_STYLE_PATH = ['dist', 'ui', 'webview', 'main.css'];

const NO_ACTIVE_FILE_MESSAGE = 'Open a file to see its flow.';
const NOT_ANALYZED_MESSAGE = 'Atlas: this file isn\'t in the Project Graph yet. Run "Atlas: Analyze Workspace" first.';

export class ActiveFileFlowPanel implements vscode.Disposable {
	private static current: ActiveFileFlowPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;

	/** The save destination/format for an in-flight `activeFileFlow:exportRequest`, awaiting the webview's `activeFileFlow:exportCaptured` reply. */
	private pendingExport: ExportDestination | undefined;

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly extensionUri: vscode.Uri,
		private store: ProjectGraphStore,
		private activeFilePath: string | undefined
	) {
		this.panel.webview.html = this.renderHtml();
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			(message: ActiveFileFlowWebviewToHostMessage) => this.handleMessage(message),
			null,
			this.disposables
		);
		this.disposables.push(vscode.window.onDidChangeActiveTextEditor((editor) => this.handleActiveEditorChanged(editor)));
	}

	/**
	 * Opens the flow view for `activeFilePath`, or reveals and refreshes the
	 * existing one (switched to `activeFilePath`) if one is already open. Takes
	 * ownership of `store` (closes it on dispose/replacement), like
	 * `GraphPanel.createOrShow`.
	 */
	static createOrShow(extensionUri: vscode.Uri, store: ProjectGraphStore, activeFilePath: string | undefined): ActiveFileFlowPanel {
		const column = vscode.window.activeTextEditor?.viewColumn;

		if (ActiveFileFlowPanel.current) {
			ActiveFileFlowPanel.current.panel.reveal(column);
			ActiveFileFlowPanel.current.replaceStore(store, activeFilePath);
			return ActiveFileFlowPanel.current;
		}

		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, VIEW_TITLE, column ?? vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'ui', 'webview')]
		});

		ActiveFileFlowPanel.current = new ActiveFileFlowPanel(panel, extensionUri, store, activeFilePath);
		return ActiveFileFlowPanel.current;
	}

	get webview(): vscode.Webview {
		return this.panel.webview;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		ActiveFileFlowPanel.current = undefined;
		this.store.close();
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.panel.dispose();
	}

	private replaceStore(store: ProjectGraphStore, activeFilePath: string | undefined): void {
		if (store !== this.store) {
			this.store.close();
		}
		this.store = store;
		if (activeFilePath) {
			this.activeFilePath = activeFilePath;
		}
		void this.postFlow();
	}

	/** A `vscode.window.activeTextEditor` change to `undefined` means a non-editor (e.g. this very panel) took focus, not that the user closed every file — ignored so the flow doesn't blank out when they click into the diagram. */
	private handleActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
		if (!editor || editor.document.uri.scheme !== 'file') {
			return;
		}
		this.activeFilePath = editor.document.uri.fsPath;
		void this.postFlow();
	}

	private handleMessage(message: ActiveFileFlowWebviewToHostMessage): void {
		if (message?.type === 'activeFileFlow:ready') {
			void this.postFlow();
		} else if (message?.type === 'activeFileFlow:openNode') {
			void this.openNode(message.nodeId);
		} else if (message?.type === 'activeFileFlow:exportRequest') {
			void this.handleExportRequest();
		} else if (message?.type === 'activeFileFlow:exportCaptured') {
			void this.handleExportCaptured(message.format, message.payload, message.width, message.height);
		} else if (message?.type === 'activeFileFlow:exportCaptureFailed') {
			this.pendingExport = undefined;
			void vscode.window.showErrorMessage('Atlas: exporting the current view failed.');
		}
	}

	private async postFlow(): Promise<void> {
		if (!this.activeFilePath) {
			this.post({ type: 'activeFileFlow:empty', message: NO_ACTIVE_FILE_MESSAGE });
			return;
		}

		const data = buildActiveFileFlowViewData(this.store.getGraph(), this.activeFilePath);
		if (!data) {
			this.post({ type: 'activeFileFlow:empty', message: NOT_ANALYZED_MESSAGE });
			return;
		}

		this.post({ type: 'activeFileFlow:update', activeFilePath: this.activeFilePath, flow: serializeFlow(data.flow) });
	}

	private post(message: ActiveFileFlowHostToWebviewMessage): void {
		void this.panel.webview.postMessage(message);
	}

	private async openNode(nodeId: string): Promise<void> {
		const node = this.store.getNode(nodeId);
		if (!node?.filePath) {
			return;
		}
		const document = await vscode.workspace.openTextDocument(node.filePath);
		await vscode.window.showTextDocument(document, { preview: true });
	}

	private async handleExportRequest(): Promise<void> {
		const destination = await pickExportDestination('active-file-flow');
		if (!destination) {
			return;
		}

		if (destination.format === 'markdown') {
			const markdown = this.buildExportMarkdown();
			if (markdown) {
				await writeMarkdownExport(destination.uri, markdown);
			}
			return;
		}

		this.pendingExport = destination;
		this.post({ type: 'activeFileFlow:exportCapture', format: destination.format });
	}

	private async handleExportCaptured(format: 'svg' | 'png' | 'pdf', payload: string, width: number, height: number): Promise<void> {
		const destination = this.pendingExport;
		this.pendingExport = undefined;
		if (!destination) {
			return;
		}
		if (format === 'svg') {
			await writeSvgExport(destination.uri, payload);
		} else if (format === 'png') {
			await writePngExport(destination.uri, payload);
		} else {
			await writePdfExportFromJpeg(destination.uri, payload, width, height);
		}
	}

	private buildExportMarkdown(): string | undefined {
		if (!this.activeFilePath) {
			return undefined;
		}
		const data = buildActiveFileFlowViewData(this.store.getGraph(), this.activeFilePath);
		if (!data) {
			return undefined;
		}

		const { model } = buildDiagramModel({ nodes: data.flow.nodes, edges: data.flow.edges });
		const activeFileName = data.flow.nodes.find((node) => node.id === data.flow.activeFileId)?.name ?? data.flow.activeFileId;
		return toMermaidMarkdown(`Active File Flow — ${activeFileName}`, diagramModelToMermaidFlowchart(model));
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
	<div id="root" data-view="activeFileFlow"></div>
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

function serializeFlow(flow: ActiveFileFlow): ActiveFileFlowPayload {
	return {
		activeFileId: flow.activeFileId,
		nodes: flow.nodes,
		edges: flow.edges,
		highlightedIds: [...flow.highlightedIds],
		rootIds: [...flow.rootIds]
	};
}
