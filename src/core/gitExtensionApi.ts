// Minimal subset of the built-in vscode.git extension's exported API (see
// https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts),
// vendored here since `@types/vscode` doesn't ship it and Agent Graph only
// needs a handful of read-only surfaces to find a workspace's uncommitted
// changes (see ./gitStatus).
import type { Event, Uri } from 'vscode';

export interface GitChange {
	readonly uri: Uri;
}

export interface GitRepositoryState {
	readonly workingTreeChanges: GitChange[];
	readonly indexChanges: GitChange[];
	/** Only present on newer vscode.git versions that split untracked files out of `workingTreeChanges` (behind the `git.untrackedChanges` setting). */
	readonly untrackedChanges?: GitChange[];
	readonly onDidChange: Event<void>;
}

export interface GitRepository {
	readonly rootUri: Uri;
	readonly state: GitRepositoryState;
	/** Forces a fresh read of the working tree/index; `state` otherwise only updates on the extension's own filesystem-watcher cadence. */
	status(): Promise<void>;
}

export interface GitAPI {
	readonly repositories: GitRepository[];
	getRepository(uri: Uri): GitRepository | null;
}

export interface GitExtensionExports {
	readonly enabled: boolean;
	getAPI(version: 1): GitAPI;
}
