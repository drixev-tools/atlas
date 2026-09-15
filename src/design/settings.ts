// Claude settings shared across every AI-powered feature (Fase 1.2, Epic G):
// the Anthropic API key (still SecretStorage-backed, see ./apiKey) plus which
// Claude model to call — a non-secret preference, so it lives in plain VS
// Code configuration instead. `ClaudeSettingsStore` is the one interface both
// pieces sit behind, narrowed like `ApiKeyStore` (./apiKey) and
// `ClaudeDesignClient` (./claudeClient) so tests can supply an in-memory
// fake; `../ui/settingsView` is the sidebar UI built on top of it, and
// `resolveClaudeSettings` below is what Design Project (../ui/designProject)
// and the future Impact/Sequence Diagram features call to get both values in
// one shot instead of duplicating either storage mechanism.
import * as vscode from 'vscode';
import { ApiKeyStore } from './apiKey';
import { DEFAULT_CLAUDE_MODEL } from './claudeClient';

export const CLAUDE_MODEL_CONFIG_SECTION = 'agentGraph';
export const CLAUDE_MODEL_CONFIG_KEY = 'claudeModel';

export interface ClaudeModelOption {
	id: string;
	label: string;
}

/**
 * The curated choices the Settings view (../ui/settingsView) offers, one per
 * Claude tier — kept short rather than listing every id `@anthropic-ai/sdk`'s
 * `Model` type allows, since most of those are dated snapshots not meant for
 * a settings dropdown. `DEFAULT_CLAUDE_MODEL` (./claudeClient) must be one of
 * these ids.
 */
export const CLAUDE_MODEL_OPTIONS: readonly ClaudeModelOption[] = [
	{ id: 'claude-opus-5', label: 'Claude Opus 5 (most capable)' },
	{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (balanced, default)' },
	{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest)' }
];

/**
 * What `VsCodeClaudeSettingsStore` needs to read/write the selected model,
 * narrowed to an interface so tests can supply an in-memory fake instead of
 * a real `vscode.workspace` configuration.
 */
export interface ModelConfigStore {
	get(): string;
	set(model: string): Promise<void>;
}

export class WorkspaceModelConfigStore implements ModelConfigStore {
	get(): string {
		return vscode.workspace
			.getConfiguration(CLAUDE_MODEL_CONFIG_SECTION)
			.get<string>(CLAUDE_MODEL_CONFIG_KEY, DEFAULT_CLAUDE_MODEL);
	}

	async set(model: string): Promise<void> {
		await vscode.workspace
			.getConfiguration(CLAUDE_MODEL_CONFIG_SECTION)
			.update(CLAUDE_MODEL_CONFIG_KEY, model, vscode.ConfigurationTarget.Global);
	}
}

export interface ClaudeSettings {
	apiKey: string;
	model: string;
}

/**
 * What every AI-powered feature needs to call Claude: the API key
 * (SecretStorage-backed) and the model (plain configuration), behind one
 * interface so `../ui/settingsView`, Design Project, and the future
 * Impact/Sequence Diagram views all read and write through the same store
 * rather than each touching `ApiKeyStore`/`ModelConfigStore` directly.
 */
export interface ClaudeSettingsStore {
	getApiKey(): Promise<string | undefined>;
	setApiKey(apiKey: string): Promise<void>;
	clearApiKey(): Promise<void>;
	getModel(): string;
	setModel(model: string): Promise<void>;
}

export class VsCodeClaudeSettingsStore implements ClaudeSettingsStore {
	constructor(
		private readonly apiKeys: ApiKeyStore,
		private readonly modelConfig: ModelConfigStore = new WorkspaceModelConfigStore()
	) {}

	getApiKey(): Promise<string | undefined> {
		return this.apiKeys.get();
	}

	setApiKey(apiKey: string): Promise<void> {
		return this.apiKeys.set(apiKey);
	}

	clearApiKey(): Promise<void> {
		return this.apiKeys.delete();
	}

	getModel(): string {
		return this.modelConfig.get();
	}

	setModel(model: string): Promise<void> {
		return this.modelConfig.set(model);
	}
}

/**
 * Resolves the API key and model every AI feature needs in one call.
 * Returns `undefined` (without prompting for anything) when no key is stored
 * yet — task 2 of Epic G replaces the old `showInputBox` prompt with the
 * sidebar Settings view (../ui/settingsView), so a caller with no key just
 * directs the user there instead of asking here.
 */
export async function resolveClaudeSettings(settings: ClaudeSettingsStore): Promise<ClaudeSettings | undefined> {
	const apiKey = await settings.getApiKey();
	if (!apiKey) {
		return undefined;
	}
	return { apiKey, model: settings.getModel() };
}
