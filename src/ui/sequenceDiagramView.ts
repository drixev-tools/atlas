// A Webview Panel showing the Claude-generated sequence diagram ./sequenceDiagram
// computes for a function/file node: a short summary plus an ordered list of
// from/to/action steps. Mirrors ./impactView's singleton create-or-reveal
// lifecycle and plain-HTML webview, kept as its own view (separate from the
// sidebar tree) per the epic's own requirement.
import * as vscode from 'vscode';
import { SequenceDiagramViewState } from './sequenceDiagram';
import { FOCUS_SETTINGS_VIEW_COMMAND } from './settingsView';

const VIEW_TYPE = 'agentGraph.sequenceDiagramView';

type WebviewToHostMessage = { type: 'ready' } | { type: 'openAiSettings' };

/**
 * Single Webview Panel for the most recently requested sequence diagram.
 * Requesting another node's diagram updates the existing panel (`update`)
 * instead of opening a second one, like `ImpactPanel.createOrShow`.
 */
export class SequenceDiagramPanel implements vscode.Disposable {
	private static current: SequenceDiagramPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;

	private constructor(private readonly panel: vscode.WebviewPanel, private state: SequenceDiagramViewState) {
		this.panel.webview.html = renderHtml(this.panel.webview);
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			(message: WebviewToHostMessage) => this.handleMessage(message),
			null,
			this.disposables
		);
	}

	/** Opens the sequence diagram view for `state`, or reveals and refreshes the existing one if it's already open. */
	static createOrShow(state: SequenceDiagramViewState): SequenceDiagramPanel {
		const column = vscode.window.activeTextEditor?.viewColumn;

		if (SequenceDiagramPanel.current) {
			SequenceDiagramPanel.current.panel.reveal(column);
			SequenceDiagramPanel.current.update(state);
			return SequenceDiagramPanel.current;
		}

		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, viewTitle(state), column ?? vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true
		});

		SequenceDiagramPanel.current = new SequenceDiagramPanel(panel, state);
		return SequenceDiagramPanel.current;
	}

	get webview(): vscode.Webview {
		return this.panel.webview;
	}

	update(state: SequenceDiagramViewState): void {
		this.state = state;
		this.panel.title = viewTitle(state);
		this.postState();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		SequenceDiagramPanel.current = undefined;
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.panel.dispose();
	}

	private handleMessage(message: WebviewToHostMessage): void {
		switch (message?.type) {
			case 'ready':
				this.postState();
				return;
			case 'openAiSettings':
				void vscode.commands.executeCommand(FOCUS_SETTINGS_VIEW_COMMAND);
				return;
		}
	}

	private postState(): void {
		void this.panel.webview.postMessage({ type: 'state', ...this.state });
	}
}

function viewTitle(state: SequenceDiagramViewState): string {
	return `Sequence: ${state.targetName}`;
}

function getNonce(): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	return nonce;
}

function renderHtml(webview: vscode.Webview): string {
	const nonce = getNonce();
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<title>Sequence Diagram</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			padding: 16px 20px;
		}
		h2 {
			margin: 0;
		}
		#filePath {
			opacity: 0.7;
			font-size: 12px;
			margin: 2px 0 12px;
		}
		#summary {
			line-height: 1.5;
			margin-bottom: 20px;
		}
		#noApiKeyNotice button, #errorNotice button {
			font: inherit;
			color: var(--vscode-textLink-foreground);
			background: none;
			border: none;
			padding: 0;
			cursor: pointer;
			text-decoration: underline;
		}
		#steps {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}
		.step {
			display: flex;
			align-items: baseline;
			gap: 8px;
			font-size: 13px;
			background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
			border: 1px solid var(--vscode-widget-border, transparent);
			border-radius: 3px;
			padding: 6px 8px;
		}
		.step-index {
			opacity: 0.6;
			min-width: 16px;
		}
		.step-participants {
			font-weight: 600;
			white-space: nowrap;
		}
		.step-arrow {
			opacity: 0.6;
		}
		.step-action {
			opacity: 0.9;
		}
		.empty {
			font-size: 12px;
			opacity: 0.6;
		}
	</style>
</head>
<body>
	<h2 id="title">Loading...</h2>
	<div id="filePath"></div>
	<p id="noApiKeyNotice" style="display: none;"></p>
	<p id="errorNotice" style="display: none;"></p>
	<div id="summary"></div>
	<div id="steps"></div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		const titleEl = document.getElementById('title');
		const filePathEl = document.getElementById('filePath');
		const noApiKeyNoticeEl = document.getElementById('noApiKeyNotice');
		const errorNoticeEl = document.getElementById('errorNotice');
		const summaryEl = document.getElementById('summary');
		const stepsEl = document.getElementById('steps');

		function settingsNotice(container, message) {
			container.style.display = 'block';
			container.textContent = '';
			container.appendChild(document.createTextNode(message + ' '));
			const link = document.createElement('button');
			link.textContent = 'Open AI Settings';
			link.addEventListener('click', () => vscode.postMessage({ type: 'openAiSettings' }));
			container.appendChild(link);
		}

		window.addEventListener('message', (event) => {
			const state = event.data;
			if (state.type !== 'state') {
				return;
			}

			titleEl.textContent = state.targetName + ' (' + state.targetKind + ')';
			filePathEl.textContent = state.filePath || '';

			noApiKeyNoticeEl.style.display = 'none';
			errorNoticeEl.style.display = 'none';
			summaryEl.textContent = '';
			stepsEl.innerHTML = '';

			if (state.status === 'noApiKey') {
				settingsNotice(noApiKeyNoticeEl, state.summary);
				return;
			}
			if (state.status === 'error') {
				errorNoticeEl.style.display = 'block';
				errorNoticeEl.textContent = state.summary;
				return;
			}

			summaryEl.textContent = state.summary;

			if (state.steps.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'empty';
				empty.textContent = 'No steps returned.';
				stepsEl.appendChild(empty);
				return;
			}

			state.steps.forEach((step, index) => {
				const row = document.createElement('div');
				row.className = 'step';

				const indexEl = document.createElement('span');
				indexEl.className = 'step-index';
				indexEl.textContent = (index + 1) + '.';
				row.appendChild(indexEl);

				const participants = document.createElement('span');
				participants.className = 'step-participants';
				participants.textContent = step.from + ' \\u2192 ' + step.to;
				row.appendChild(participants);

				const arrow = document.createElement('span');
				arrow.className = 'step-arrow';
				arrow.textContent = ':';
				row.appendChild(arrow);

				const action = document.createElement('span');
				action.className = 'step-action';
				action.textContent = step.action;
				row.appendChild(action);

				stepsEl.appendChild(row);
			});
		});

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}
