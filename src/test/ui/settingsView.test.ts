import * as assert from 'assert';
import * as vscode from 'vscode';
import { ClaudeSettingsStore } from '../../design/settings';
import { SettingsViewProvider } from '../../ui/settingsView';

function fakeClaudeSettingsStore(initial?: { apiKey?: string; model?: string }): ClaudeSettingsStore & { apiKey: string | undefined; model: string } {
	const state = { apiKey: initial?.apiKey, model: initial?.model ?? 'claude-sonnet-5' };
	return {
		get apiKey() {
			return state.apiKey;
		},
		get model() {
			return state.model;
		},
		async getApiKey() {
			return state.apiKey;
		},
		async setApiKey(apiKey: string) {
			state.apiKey = apiKey;
		},
		async clearApiKey() {
			state.apiKey = undefined;
		},
		getModel() {
			return state.model;
		},
		async setModel(model: string) {
			state.model = model;
		}
	};
}

/**
 * A minimal stand-in for `vscode.WebviewView`, covering only what
 * `SettingsViewProvider` touches (`webview.options`/`.html`/
 * `.onDidReceiveMessage`/`.postMessage`/`.cspSource`) — there is no lighter
 * way to exercise its message handling without a real webview host.
 */
function fakeWebviewView(): {
	webviewView: vscode.WebviewView;
	postedMessages: unknown[];
	sendFromWebview: (message: unknown) => void;
} {
	let messageHandler: ((message: unknown) => void) | undefined;
	const postedMessages: unknown[] = [];

	const webview = {
		cspSource: 'vscode-webview:',
		options: {},
		html: '',
		onDidReceiveMessage(handler: (message: unknown) => void) {
			messageHandler = handler;
			return { dispose() {} };
		},
		async postMessage(message: unknown) {
			postedMessages.push(message);
			return true;
		}
	};

	const webviewView = { webview } as unknown as vscode.WebviewView;
	return {
		webviewView,
		postedMessages,
		sendFromWebview: (message: unknown) => messageHandler?.(message)
	};
}

suite('SettingsViewProvider', () => {
	test('posts the current state as soon as the view resolves', async () => {
		const settings = fakeClaudeSettingsStore({ apiKey: 'sk-ant-existing', model: 'claude-opus-5' });
		const provider = new SettingsViewProvider(settings);
		const { webviewView, postedMessages } = fakeWebviewView();

		provider.resolveWebviewView(webviewView);
		await flushMicrotasks();

		assert.strictEqual(postedMessages.length, 1);
		const state = postedMessages[0] as { type: string; hasApiKey: boolean; model: string; models: unknown[] };
		assert.strictEqual(state.type, 'state');
		assert.strictEqual(state.hasApiKey, true);
		assert.strictEqual(state.model, 'claude-opus-5');
		assert.ok(Array.isArray(state.models) && state.models.length > 0);
	});

	test('saving a non-empty API key stores it and re-posts state with hasApiKey true', async () => {
		const settings = fakeClaudeSettingsStore();
		const provider = new SettingsViewProvider(settings);
		const { webviewView, postedMessages, sendFromWebview } = fakeWebviewView();

		provider.resolveWebviewView(webviewView);
		await flushMicrotasks();

		sendFromWebview({ type: 'saveApiKey', apiKey: '  sk-ant-new  ' });
		await flushMicrotasks();

		assert.strictEqual(settings.apiKey, 'sk-ant-new');
		const lastState = postedMessages[postedMessages.length - 1] as { hasApiKey: boolean };
		assert.strictEqual(lastState.hasApiKey, true);
	});

	test('saving a blank API key is a no-op', async () => {
		const settings = fakeClaudeSettingsStore();
		const provider = new SettingsViewProvider(settings);
		const { webviewView, sendFromWebview } = fakeWebviewView();

		provider.resolveWebviewView(webviewView);
		await flushMicrotasks();

		sendFromWebview({ type: 'saveApiKey', apiKey: '   ' });
		await flushMicrotasks();

		assert.strictEqual(settings.apiKey, undefined);
	});

	test('clearing the API key removes it and re-posts state with hasApiKey false', async () => {
		const settings = fakeClaudeSettingsStore({ apiKey: 'sk-ant-existing' });
		const provider = new SettingsViewProvider(settings);
		const { webviewView, postedMessages, sendFromWebview } = fakeWebviewView();

		provider.resolveWebviewView(webviewView);
		await flushMicrotasks();

		sendFromWebview({ type: 'clearApiKey' });
		await flushMicrotasks();

		assert.strictEqual(settings.apiKey, undefined);
		const lastState = postedMessages[postedMessages.length - 1] as { hasApiKey: boolean };
		assert.strictEqual(lastState.hasApiKey, false);
	});

	test('setting the model persists it via the settings store', async () => {
		const settings = fakeClaudeSettingsStore({ model: 'claude-sonnet-5' });
		const provider = new SettingsViewProvider(settings);
		const { webviewView, sendFromWebview } = fakeWebviewView();

		provider.resolveWebviewView(webviewView);
		await flushMicrotasks();

		sendFromWebview({ type: 'setModel', model: 'claude-haiku-4-5' });
		await flushMicrotasks();

		assert.strictEqual(settings.model, 'claude-haiku-4-5');
	});
});

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
