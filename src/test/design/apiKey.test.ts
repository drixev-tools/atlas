import * as assert from 'assert';
import { ApiKeyStore, ensureAnthropicApiKey } from '../../design/apiKey';

function fakeApiKeyStore(initial?: string): ApiKeyStore & { stored: string | undefined; deleted: boolean } {
	const store = {
		stored: initial,
		deleted: false,
		async get() {
			return store.stored;
		},
		async set(apiKey: string) {
			store.stored = apiKey;
		},
		async delete() {
			store.deleted = true;
			store.stored = undefined;
		}
	};
	return store;
}

suite('ensureAnthropicApiKey', () => {
	test('returns the already-stored key without prompting', async () => {
		const apiKeys = fakeApiKeyStore('sk-ant-existing');
		let prompted = false;

		const result = await ensureAnthropicApiKey(apiKeys, async () => {
			prompted = true;
			return 'sk-ant-new';
		});

		assert.strictEqual(result, 'sk-ant-existing');
		assert.strictEqual(prompted, false);
	});

	test('prompts and persists a new key when none is stored', async () => {
		const apiKeys = fakeApiKeyStore(undefined);

		const result = await ensureAnthropicApiKey(apiKeys, async () => 'sk-ant-new');

		assert.strictEqual(result, 'sk-ant-new');
		assert.strictEqual(apiKeys.stored, 'sk-ant-new');
	});

	test('returns undefined without storing anything when the prompt is cancelled', async () => {
		const apiKeys = fakeApiKeyStore(undefined);

		const result = await ensureAnthropicApiKey(apiKeys, async () => undefined);

		assert.strictEqual(result, undefined);
		assert.strictEqual(apiKeys.stored, undefined);
	});
});
