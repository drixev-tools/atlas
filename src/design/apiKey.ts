// Anthropic API key management (Epic 9, task 2): the key is never stored in
// workspace settings or the Project Graph database, only in VS Code's
// SecretStorage (OS keychain-backed). It used to be collected via a
// `showInputBox` prompt the first time "Design Project" ran without one
// stored; Fase 1.2, Epic G replaced that prompt with the sidebar Settings
// view (../ui/settingsView, via ./settings' `ClaudeSettingsStore`), which
// reads and writes through the same `ApiKeyStore` below.
import * as vscode from 'vscode';

export const ANTHROPIC_API_KEY_SECRET_KEY = 'agentGraph.anthropicApiKey';

/**
 * What `ClaudeSettingsStore` (./settings) needs from secret storage, narrowed
 * to an interface — separate from the concrete `SecretStorageApiKeyStore` —
 * so tests can supply an in-memory fake instead of a real VS Code extension
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
