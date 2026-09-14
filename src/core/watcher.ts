import * as path from 'path';
import * as vscode from 'vscode';
import { PythonServer, runPythonPipeline } from '../pipelines/python';
import { runTsPipeline } from '../pipelines/ts';
import { applyFileGraph, knownProjectFiles, removeFileGraph } from './incremental';
import { GraphStatus } from './schema';
import { ProjectGraphStore } from './store';

const WATCH_GLOB = '**/*.{ts,tsx,js,jsx,py}';

/**
 * Directory names skipped by the watcher, mirroring the ignore lists each
 * pipeline's own `findSourceFiles` already applies for full scans (see
 * `pipelines/ts/files.ts` and `pipelines/python/files.ts`).
 */
const IGNORED_DIR_NAMES = new Set([
	'node_modules',
	'.git',
	'dist',
	'out',
	'.vscode-test',
	'coverage',
	'__pycache__',
	'.venv',
	'venv',
	'.mypy_cache',
	'.pytest_cache'
]);

export type WatchedLanguage = 'ts' | 'python';

function isIgnoredPath(filePath: string): boolean {
	return filePath.split(/[\\/]/).some((segment) => IGNORED_DIR_NAMES.has(segment));
}

/** Which pipeline a changed file belongs to, or `undefined` for files the watcher should ignore (e.g. `.d.ts`). */
export function languageForFile(filePath: string): WatchedLanguage | undefined {
	if (isIgnoredPath(filePath) || filePath.endsWith('.d.ts')) {
		return undefined;
	}
	switch (path.extname(filePath).toLowerCase()) {
		case '.ts':
		case '.tsx':
		case '.js':
		case '.jsx':
			return 'ts';
		case '.py':
			return 'python';
		default:
			return undefined;
	}
}

export interface ProjectGraphWatcherOptions {
	/** Workspace folder the watched files belong to, used to resolve imports and discover sibling files. */
	rootDir: string;
	store: ProjectGraphStore;
	/** Status to tag incrementally updated nodes/edges with. Defaults to `observed_only`, matching `populateProjectGraph`. */
	status?: GraphStatus;
	/**
	 * Persistent Python interpreter reused across incremental re-parses so
	 * each edit doesn't pay interpreter startup cost. Created and owned by
	 * the watcher (started on first Python file event, stopped on dispose)
	 * when omitted.
	 */
	pythonServer?: PythonServer;
	/** Reports errors from a failed re-parse/update instead of throwing out of the watcher's event handlers. Defaults to `console.error`. */
	onError?: (error: unknown, filePath: string) => void;
}

/**
 * Watches the TS/JS and Python source files of a workspace folder and keeps
 * the Project Graph Core in sync as they change, without ever re-running a
 * full workspace scan: each create/change re-extracts just that one file
 * through the pipeline for its language and applies only that file's
 * nodes/edges to the store (`applyFileGraph`); each delete removes just that
 * file's nodes/edges (`removeFileGraph`).
 */
export class ProjectGraphWatcher implements vscode.Disposable {
	private readonly watcher: vscode.FileSystemWatcher;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly pythonServer: PythonServer;
	private readonly ownsPythonServer: boolean;
	private readonly onError: (error: unknown, filePath: string) => void;

	/** Serializes handling of watcher events so overlapping edits to the same file apply in order. */
	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly options: ProjectGraphWatcherOptions) {
		this.pythonServer = options.pythonServer ?? new PythonServer();
		this.ownsPythonServer = !options.pythonServer;
		this.onError = options.onError ?? ((error, filePath) => console.error(`Agent Graph: failed to update ${filePath}`, error));

		this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(options.rootDir, WATCH_GLOB));
		this.disposables.push(
			this.watcher,
			this.watcher.onDidCreate((uri) => this.enqueue(uri.fsPath, () => this.handleUpsert(uri.fsPath))),
			this.watcher.onDidChange((uri) => this.enqueue(uri.fsPath, () => this.handleUpsert(uri.fsPath))),
			this.watcher.onDidDelete((uri) => this.enqueue(uri.fsPath, () => this.handleDelete(uri.fsPath)))
		);
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		if (this.ownsPythonServer) {
			void this.pythonServer.stop();
		}
	}

	private enqueue(filePath: string, task: () => Promise<void>): void {
		this.queue = this.queue.then(task).catch((error) => this.onError(error, filePath));
	}

	private async handleUpsert(filePath: string): Promise<void> {
		const language = languageForFile(filePath);
		if (!language) {
			return;
		}

		const resolvedPath = path.resolve(filePath);
		const knownFiles = knownProjectFiles(this.options.store);

		const graph =
			language === 'ts'
				? runTsPipeline(this.options.rootDir, { files: [resolvedPath], knownFiles })
				: await runPythonPipeline(this.options.rootDir, {
						files: [resolvedPath],
						knownFiles,
						server: this.pythonServer
				  });

		applyFileGraph(this.options.store, resolvedPath, graph, { status: this.options.status });
	}

	private async handleDelete(filePath: string): Promise<void> {
		if (!languageForFile(filePath)) {
			return;
		}
		removeFileGraph(this.options.store, path.resolve(filePath));
	}
}
