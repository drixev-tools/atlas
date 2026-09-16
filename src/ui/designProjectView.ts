// Webview View registered alongside the Tree View and Settings webview view
// (./sidebarView, ./settingsView) in the same Activity Bar container. Lets a
// user describe intent for a new project/feature via a form instead of the
// former QuickInput/scratch-editor flow, and hands the result to the same
// `designProject` orchestration (./designProject) the old command used —
// this view owns the `vscode`-specific presentation only, never a second
// copy of that logic.
import * as vscode from 'vscode';
import { AnthropicClaudeDesignClient, AuthenticationError, ClaudeSettingsStore, ProjectIntent, ProjectStack, resolveClaudeSettings } from '../design';
import { designProject, DesignProjectResult } from './designProject';
import { OPEN_ARCHITECTURE_COMMAND } from './architecture';
import { FOCUS_SETTINGS_VIEW_COMMAND } from './settingsView';

export const DESIGN_PROJECT_VIEW_ID = 'agentGraph.designProjectView';
export const FOCUS_DESIGN_PROJECT_VIEW_COMMAND = `${DESIGN_PROJECT_VIEW_ID}.focus`;

const OPEN_ARCHITECTURE_ACTION = 'Open Architecture';
const OPEN_AI_SETTINGS_ACTION = 'Open AI Settings';

type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'submit'; name: string; stack: ProjectStack; keyComponents: string; description: string };

type ExtensionToWebviewMessage = { type: 'progress'; message: string } | { type: 'result'; ok: true } | { type: 'result'; ok: false; message: string };

export interface DesignProjectViewDependencies {
	settings: ClaudeSettingsStore;
	resolveRootDir: () => string | undefined;
	resolveDbPath: () => string | undefined;
	/** Fired once a submission actually starts (i.e. passed client-side validation), for usage metrics. */
	onSubmit?: () => void;
	/** Fired after a successful design, so the sidebar tree can be refreshed. */
	onDesigned?: () => void | Promise<void>;
}

export class DesignProjectViewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;

	constructor(private readonly deps: DesignProjectViewDependencies) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = renderHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => void this.handleMessage(message));
	}

	private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
		if (message.type === 'submit') {
			await this.submit(message);
		}
	}

	private async submit(message: Extract<WebviewToExtensionMessage, { type: 'submit' }>): Promise<void> {
		const name = message.name.trim();
		const description = message.description.trim();
		if (!name || !description) {
			this.post({ type: 'result', ok: false, message: 'A name and a description are required.' });
			return;
		}

		const rootDir = this.deps.resolveRootDir();
		if (!rootDir) {
			this.post({ type: 'result', ok: false, message: 'Open a folder or workspace before designing a project.' });
			return;
		}

		const settings = await resolveClaudeSettings(this.deps.settings);
		if (!settings) {
			this.post({ type: 'result', ok: false, message: 'An Anthropic API key is required to design a project.' });
			void this.promptToOpenAiSettings('an Anthropic API key is required to design a project');
			return;
		}

		this.deps.onSubmit?.();

		const intent: ProjectIntent = {
			name,
			stack: message.stack,
			keyComponents: message.keyComponents
				.split(',')
				.map((component) => component.trim())
				.filter((component) => component.length > 0),
			description
		};

		try {
			const result = await designProject({
				rootDir,
				dbPath: this.deps.resolveDbPath(),
				intent,
				claudeClient: new AnthropicClaudeDesignClient(settings.apiKey, settings.model),
				onProgress: (progressMessage) => this.post({ type: 'progress', message: progressMessage })
			});
			await this.deps.onDesigned?.();
			this.post({ type: 'result', ok: true });
			void this.presentResult(result);
		} catch (error) {
			if (error instanceof AuthenticationError) {
				await this.deps.settings.clearApiKey();
				this.post({ type: 'result', ok: false, message: 'Anthropic rejected the stored API key — it has been cleared.' });
				void this.promptToOpenAiSettings('Anthropic rejected the stored API key — it has been cleared');
				return;
			}
			this.post({
				type: 'result',
				ok: false,
				message: `Designing the project failed — ${error instanceof Error ? error.message : String(error)}`
			});
		}
	}

	private async presentResult(result: DesignProjectResult): Promise<void> {
		const choice = await vscode.window.showInformationMessage(
			`Project Graph: proposed architecture ready — ${result.nodeCount} node(s), ${result.edgeCount} edge(s), ` +
				`${result.matchedNodeCount} already in the code. Open the graph to review it.`,
			OPEN_ARCHITECTURE_ACTION
		);
		if (choice === OPEN_ARCHITECTURE_ACTION) {
			await vscode.commands.executeCommand(OPEN_ARCHITECTURE_COMMAND);
		}
	}

	private async promptToOpenAiSettings(reason: string): Promise<void> {
		const choice = await vscode.window.showErrorMessage(
			`Project Graph: ${reason} — configure it in the AI Settings sidebar view.`,
			OPEN_AI_SETTINGS_ACTION
		);
		if (choice === OPEN_AI_SETTINGS_ACTION) {
			await vscode.commands.executeCommand(FOCUS_SETTINGS_VIEW_COMMAND);
		}
	}

	private post(message: ExtensionToWebviewMessage): void {
		void this.view?.webview.postMessage(message);
	}
}

export function registerDesignProjectView(context: vscode.ExtensionContext, deps: DesignProjectViewDependencies): DesignProjectViewProvider {
	const provider = new DesignProjectViewProvider(deps);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(DESIGN_PROJECT_VIEW_ID, provider));
	return provider;
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
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			padding: 0 8px 8px;
		}
		p.description {
			font-size: 12px;
			opacity: 0.8;
			margin: 8px 0;
		}
		label {
			display: block;
			font-size: 11px;
			text-transform: uppercase;
			opacity: 0.8;
			margin: 10px 0 4px;
		}
		input, select, textarea, button {
			width: 100%;
			box-sizing: border-box;
			font-family: inherit;
			font-size: 12px;
			padding: 4px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, transparent);
		}
		textarea {
			min-height: 90px;
			resize: vertical;
		}
		button {
			margin-top: 12px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			cursor: pointer;
			padding: 6px;
		}
		button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		button:disabled {
			opacity: 0.6;
			cursor: default;
		}
		#status {
			font-size: 12px;
			margin-top: 8px;
			min-height: 16px;
		}
		#status.error {
			color: var(--vscode-errorForeground);
		}
	</style>
</head>
<body>
	<p class="description">Describe a new project or feature; Claude proposes an architecture for it as a Proposed Graph.</p>

	<label for="nameInput">Name</label>
	<input id="nameInput" type="text" placeholder="e.g. Auth Service" />

	<label for="stackSelect">Stack</label>
	<select id="stackSelect">
		<option value="typescript">TypeScript / JavaScript</option>
		<option value="python">Python</option>
		<option value="mixed">Mixed / other</option>
	</select>

	<label for="keyComponentsInput">Key components (optional, comma-separated)</label>
	<input id="keyComponentsInput" type="text" placeholder="e.g. loginService, tokenStore" />

	<label for="descriptionInput">Description</label>
	<textarea id="descriptionInput" placeholder="What should this project/feature do, and how should its main pieces fit together?"></textarea>

	<button id="submitButton">Design Project</button>
	<div id="status"></div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		const nameInput = document.getElementById('nameInput');
		const stackSelect = document.getElementById('stackSelect');
		const keyComponentsInput = document.getElementById('keyComponentsInput');
		const descriptionInput = document.getElementById('descriptionInput');
		const submitButton = document.getElementById('submitButton');
		const status = document.getElementById('status');

		function setStatus(message, isError) {
			status.textContent = message || '';
			status.classList.toggle('error', Boolean(isError));
		}

		submitButton.addEventListener('click', () => {
			submitButton.disabled = true;
			setStatus('');
			vscode.postMessage({
				type: 'submit',
				name: nameInput.value,
				stack: stackSelect.value,
				keyComponents: keyComponentsInput.value,
				description: descriptionInput.value
			});
		});

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.type === 'progress') {
				setStatus(message.message, false);
				return;
			}
			if (message.type === 'result') {
				submitButton.disabled = false;
				if (message.ok) {
					nameInput.value = '';
					keyComponentsInput.value = '';
					descriptionInput.value = '';
					stackSelect.value = 'typescript';
					setStatus('Proposed architecture ready.', false);
				} else {
					setStatus(message.message, true);
				}
			}
		});

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}
