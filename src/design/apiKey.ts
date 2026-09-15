// Anthropic API key management (Epic 9, task 2): the key is never stored in
// workspace settings or the Project Graph database, only in VS Code's
// SecretStorage (OS keychain-backed), and only entered once per install.
import * as vscode from 'vscode';

export const ANTHROPIC_API_KEY_SECRET_KEY = 'agentGraph.anthropicApiKey';

/**
 * What `ensureAnthropicApiKey` needs from secret storage, narrowed to an
 * interface — separate from the concrete `SecretStorageApiKeyStore` — so
 * tests can supply an in-memory fake instead of a real VS Code extension
 * host, matching `GitStatusSource` (../core/gitStatus) and `ClaudeDesignClient`
 * (./claudeClient).
 */
export interface ApiKeyStore {
	get(): Promise<string | undefined>;
	set(apiKey: string): Promise<void>;
	delete(): Promise<void>;
}

export class SecretStorageApiKeyStore implements ApiKeyStore {
	constructor(private readonly secrets: vscode.SecretStorage) {}

	async get(): Promise<string | undefined> {
		return this.secrets.get(ANTHROPIC_API_KEY_SECRET_KEY);
	}

	async set(apiKey: string): Promise<void> {
		await this.secrets.store(ANTHROPIC_API_KEY_SECRET_KEY, apiKey);
	}

	async delete(): Promise<void> {
		await this.secrets.delete(ANTHROPIC_API_KEY_SECRET_KEY);
	}
}

/**
 * Returns the Anthropic API key from `apiKeys`, prompting the user to paste
 * one — and persisting it back via `apiKeys.set` — the first time "Design
 * Project" runs without one already stored. Returns `undefined` if the user
 * cancels the prompt, in which case nothing is written to `apiKeys`.
 */
export async function ensureAnthropicApiKey(
	apiKeys: ApiKeyStore,
	promptForApiKey: () => Promise<string | undefined> = defaultPromptForApiKey
): Promise<string | undefined> {
	const stored = await apiKeys.get();
	if (stored) {
		return stored;
	}

	const entered = await promptForApiKey();
	if (!entered) {
		return undefined;
	}

	await apiKeys.set(entered);
	return entered;
}

async function defaultPromptForApiKey(): Promise<string | undefined> {
	const value = await vscode.window.showInputBox({
		title: 'Project Graph: Anthropic API Key',
		prompt: 'Enter your Anthropic API key to design a proposed architecture with Claude. It is stored securely via VS Code SecretStorage, not in any workspace file.',
		placeHolder: 'sk-ant-...',
		password: true,
		ignoreFocusOut: true,
		validateInput: (input) => (input.trim().length === 0 ? 'An API key is required.' : undefined)
	});
	return value?.trim() || undefined;
}
