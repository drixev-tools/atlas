import * as assert from 'assert';
import { ApiKeyStore } from '../../design/apiKey';
import { ModelConfigStore, resolveClaudeSettings, VsCodeClaudeSettingsStore } from '../../design/settings';

function fakeApiKeyStore(initial?: string): ApiKeyStore & { stored: string | undefined } {
	const store = {
		stored: initial,
		async get() {
			return store.stored;
		},
		async set(apiKey: string) {
			store.stored = apiKey;
		},
		async delete() {
			store.stored = undefined;
		}
	};
	return store;
}

function fakeModelConfigStore(initial: string): ModelConfigStore & { current: string } {
	const store = {
		current: initial,
		get() {
			return store.current;
		},
		async set(model: string) {
			store.current = model;
		}
	};
	return store;
}

suite('VsCodeClaudeSettingsStore', () => {
	test('delegates the API key to the given ApiKeyStore', async () => {
		const apiKeys = fakeApiKeyStore();
		const settings = new VsCodeClaudeSettingsStore(apiKeys, fakeModelConfigStore('claude-sonnet-5'));

		assert.strictEqual(await settings.getApiKey(), undefined);

		await settings.setApiKey('sk-ant-new');
		assert.strictEqual(apiKeys.stored, 'sk-ant-new');
		assert.strictEqual(await settings.getApiKey(), 'sk-ant-new');

		await settings.clearApiKey();
		assert.strictEqual(apiKeys.stored, undefined);
	});

	test('delegates the model to the given ModelConfigStore', async () => {
		const modelConfig = fakeModelConfigStore('claude-sonnet-5');
		const settings = new VsCodeClaudeSettingsStore(fakeApiKeyStore(), modelConfig);

		assert.strictEqual(settings.getModel(), 'claude-sonnet-5');

		await settings.setModel('claude-opus-5');
		assert.strictEqual(modelConfig.current, 'claude-opus-5');
		assert.strictEqual(settings.getModel(), 'claude-opus-5');
	});
});

suite('resolveClaudeSettings', () => {
	test('returns undefined without prompting when no API key is stored', async () => {
		const settings = new VsCodeClaudeSettingsStore(fakeApiKeyStore(), fakeModelConfigStore('claude-sonnet-5'));

		assert.strictEqual(await resolveClaudeSettings(settings), undefined);
	});

	test('returns the stored API key together with the configured model', async () => {
		const settings = new VsCodeClaudeSettingsStore(fakeApiKeyStore('sk-ant-existing'), fakeModelConfigStore('claude-haiku-4-5'));

		assert.deepStrictEqual(await resolveClaudeSettings(settings), { apiKey: 'sk-ant-existing', model: 'claude-haiku-4-5' });
	});
});
