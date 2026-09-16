// vscode.git integration: reads the workspace's currently uncommitted
// files, for "Calculate Impact" (./impact, ../ui/impact) to seed
// its impact analysis from. See ./gitExtensionApi for the (vendored) shape of
// the extension's API this talks to.
import * as path from 'path';
import * as vscode from 'vscode';
import { GitExtensionExports, GitRepository } from './gitExtensionApi';

const GIT_EXTENSION_ID = 'vscode.git';
const DEFAULT_TTL_MS = 5000;

/**
 * What `calculateImpact` (../ui/impact) actually needs from git status —
 * narrowed to an interface, separate from the concrete `GitStatusProvider`,
 * so tests can supply a fake changed-file list instead of depending on a real
 * git repository being open in the test host.
 */
export interface GitStatusSource {
	getChangedFiles(rootDir: string): Promise<string[]>;
}

export interface GitStatusProviderOptions {
	/**
	 * How long a cached result is served before a background refresh is
	 * kicked off. Short enough that Impact doesn't act on a stale working
	 * tree, long enough that repeated calls (e.g. rerunning the command a few
	 * seconds apart) don't each pay for a fresh `git status`. Defaults to 5s.
	 */
	ttlMs?: number;
}

/**
 * Serves a workspace's uncommitted changes (staged, unstaged, and untracked
 * files) through the built-in vscode.git extension, never blocking a caller
 * on a fresh `git status` beyond the very first call per repository root:
 * every call after that returns the cached list immediately and, once it's
 * older than `ttlMs`, refreshes it in the background for the *next* call to
 * pick up.
 */
export class GitStatusProvider implements GitStatusSource {
	private readonly ttlMs: number;
	private readonly cacheByRoot = new Map<string, { timestamp: number; files: string[] }>();
	private readonly refreshesByRoot = new Map<string, Promise<void>>();

	constructor(options: GitStatusProviderOptions = {}) {
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	}

	/** Absolute paths of files with uncommitted changes in the repository containing `rootDir`, or `[]` when vscode.git is unavailable/disabled or `rootDir` isn't inside a git repository. */
	async getChangedFiles(rootDir: string): Promise<string[]> {
		const cached = this.cacheByRoot.get(rootDir);
		if (!cached) {
			await this.refresh(rootDir);
			return this.cacheByRoot.get(rootDir)?.files ?? [];
		}

		if (Date.now() - cached.timestamp >= this.ttlMs) {
			void this.refresh(rootDir);
		}
		return cached.files;
	}

	private refresh(rootDir: string): Promise<void> {
		const inFlight = this.refreshesByRoot.get(rootDir);
		if (inFlight) {
			return inFlight;
		}
		const promise = this.doRefresh(rootDir).finally(() => this.refreshesByRoot.delete(rootDir));
		this.refreshesByRoot.set(rootDir, promise);
		return promise;
	}

	private async doRefresh(rootDir: string): Promise<void> {
		try {
			const files = await fetchChangedFiles(rootDir);
			this.cacheByRoot.set(rootDir, { timestamp: Date.now(), files });
		} catch (error) {
			console.error('Agent Graph: failed to read git status', error);
			if (!this.cacheByRoot.has(rootDir)) {
				this.cacheByRoot.set(rootDir, { timestamp: Date.now(), files: [] });
			}
		}
	}
}

async function fetchChangedFiles(rootDir: string): Promise<string[]> {
	const repository = await getRepositoryForRoot(rootDir);
	if (!repository) {
		return [];
	}
	await repository.status();

	const changes = [...repository.state.workingTreeChanges, ...repository.state.indexChanges, ...(repository.state.untrackedChanges ?? [])];
	return [...new Set(changes.map((change) => change.uri.fsPath))];
}

async function getRepositoryForRoot(rootDir: string): Promise<GitRepository | undefined> {
	const extension = vscode.extensions.getExtension<GitExtensionExports>(GIT_EXTENSION_ID);
	if (!extension) {
		return undefined;
	}

	const gitExtension = extension.isActive ? extension.exports : await extension.activate();
	if (!gitExtension.enabled) {
		return undefined;
	}

	const api = gitExtension.getAPI(1);
	const byUri = api.getRepository(vscode.Uri.file(rootDir));
	if (byUri) {
		return byUri;
	}

	const resolvedRoot = path.resolve(rootDir);
	return api.repositories.find((repository) => resolvedRoot.startsWith(path.resolve(repository.rootUri.fsPath)));
}
