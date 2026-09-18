// The "Identified Architecture" view's panel lifecycle and postMessage
// bridge (contract in ./webview/identifiedArchitectureProtocol) — mirrors
// ./sequenceDiagramView's singleton create-or-reveal shape, as its own
// `WebviewPanel` separate from "Open Architecture" (../graphPanel), loading
// the same bundled React Flow script (../webview/main.tsx picks the root
// component via `data-view`). This panel owns no `AtlasStore`: the
// diagram is precomputed by whichever command opens/updates it
// (../extension.ts's `runShowIdentifiedArchitectureCommand`), like
// ./sequenceDiagramView.
import * as vscode from 'vscode';
import { diagramModelToMermaidFlowchart } from '../core/diagramMermaid';
import { ExportDestination, pickExportDestination, writeMarkdownExport, writePdfExportFromJpeg, writePngExport, writeSvgExport } from './diagramExport';
import { IdentifiedArchitectureModel } from './identifiedArchitecture';
import { FOCUS_SETTINGS_VIEW_COMMAND } from './settingsView';
import { IdentifiedArchitectureHostToWebviewMessage, IdentifiedArchitectureWebviewToHostMessage } from './webview/identifiedArchitectureProtocol';

const VIEW_TYPE = 'atlas.identifiedArchitectureView';
const VIEW_TITLE = 'Identified Architecture (AI)';
const WEBVIEW_SCRIPT_PATH = ['dist', 'ui', 'webview', 'main.js'];
const WEBVIEW_STYLE_PATH = ['dist', 'ui', 'webview', 'main.css'];

export type IdentifiedArchitectureStatus = 'ready' | 'loading' | 'needsApiKey' | 'empty';

export class IdentifiedArchitecturePanel implements vscode.Disposable {
	private static current: IdentifiedArchitecturePanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;

	/** The save destination/format for an in-flight `identifiedArchitecture:exportRequest`, awaiting the webview's `identifiedArchitecture:exportCaptured` reply. */
	private pendingExport: ExportDestination | undefined;

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly extensionUri: vscode.Uri,
		private model: IdentifiedArchitectureModel | undefined,
		private status: IdentifiedArchitectureStatus
	) {
		this.panel.webview.html = this.renderHtml();
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			(message: IdentifiedArchitectureWebviewToHostMessage) => this.handleMessage(message),
			null,
			this.disposables
		);
	}

	/** Opens the view, or reveals and refreshes the existing one if it's already open. */
	static createOrShow(
		extensionUri: vscode.Uri,
		model: IdentifiedArchitectureModel | undefined,
		status: IdentifiedArchitectureStatus
	): IdentifiedArchitecturePanel {
		const column = vscode.window.activeTextEditor?.viewColumn;

		if (IdentifiedArchitecturePanel.current) {
			IdentifiedArchitecturePanel.current.panel.reveal(column);
			IdentifiedArchitecturePanel.current.update(model, status);
			return IdentifiedArchitecturePanel.current;
		}

		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, VIEW_TITLE, column ?? vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'ui', 'webview')]
		});

		IdentifiedArchitecturePanel.current = new IdentifiedArchitecturePanel(panel, extensionUri, model, status);
		return IdentifiedArchitecturePanel.current;
	}

	get webview(): vscode.Webview {
		return this.panel.webview;
	}

	update(model: IdentifiedArchitectureModel | undefined, status: IdentifiedArchitectureStatus): void {
		this.model = model;
		this.status = status;
		this.postState();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		IdentifiedArchitecturePanel.current = undefined;
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.panel.dispose();
	}

	private handleMessage(message: IdentifiedArchitectureWebviewToHostMessage): void {
		switch (message?.type) {
			case 'identifiedArchitecture:ready':
				this.postState();
				return;
			case 'identifiedArchitecture:openAiSettings':
				void vscode.commands.executeCommand(FOCUS_SETTINGS_VIEW_COMMAND);
				return;
			case 'identifiedArchitecture:exportRequest':
				void this.handleExportRequest();
				return;
			case 'identifiedArchitecture:exportCaptured':
				void this.handleExportCaptured(message.format, message.payload, message.width, message.height);
				return;
			case 'identifiedArchitecture:exportCaptureFailed':
				this.pendingExport = undefined;
				void vscode.window.showErrorMessage('Atlas: exporting the current view failed.');
				return;
		}
	}

	private async handleExportRequest(): Promise<void> {
		if (!this.model) {
			return;
		}
		const destination = await pickExportDestination('identified-architecture');
		if (!destination) {
			return;
		}

		if (destination.format === 'markdown') {
			await writeMarkdownExport(destination.uri, buildExportMarkdown(this.model));
			return;
		}

		this.pendingExport = destination;
		const message: IdentifiedArchitectureHostToWebviewMessage = { type: 'identifiedArchitecture:exportCapture', format: destination.format };
		void this.panel.webview.postMessage(message);
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

	private postState(): void {
		if (this.model) {
			const message: IdentifiedArchitectureHostToWebviewMessage = {
				type: 'identifiedArchitecture:update',
				payload: {
					model: this.model.model,
					patternName: this.model.patternName,
					patternDescription: this.model.patternDescription,
					roleDescriptionsByGroupId: this.model.roleDescriptionsByGroupId
				}
			};
			void this.panel.webview.postMessage(message);
			return;
		}
		const message: IdentifiedArchitectureHostToWebviewMessage =
			this.status === 'needsApiKey'
				? { type: 'identifiedArchitecture:needsApiKey' }
				: this.status === 'loading'
				? { type: 'identifiedArchitecture:loading' }
				: { type: 'identifiedArchitecture:empty' };
		void this.panel.webview.postMessage(message);
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
	<div id="root" data-view="identifiedArchitecture"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function buildExportMarkdown(model: IdentifiedArchitectureModel): string {
	return [
		`# Identified Architecture — ${model.patternName}`,
		'',
		"> AI-generated interpretation of this codebase's architecture, inferred by Claude from the extracted Atlas — not verified project structure.",
		'',
		model.patternDescription,
		'',
		'```mermaid',
		diagramModelToMermaidFlowchart(model.model),
		'```',
		''
	].join('\n');
}

function getNonce(): string {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
