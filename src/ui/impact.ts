// "Calculate Impact" orchestration: ties the structural dependency/consumer
// analysis (../core/impact), the test<->code relation (../core/testLinks),
// and the vscode.git-backed changed-file list (../core/gitStatus) together
// into the result the "Project Graph: Calculate Impact" command presents.
import * as path from 'path';
import { getStructuralConsumersForFile, getStructuralDependenciesForFile } from '../core/impact';
import { GitStatusProvider, GitStatusSource } from '../core/gitStatus';
import { findRelatedTestFiles } from '../core/testLinks';
import { ProjectGraphStore } from '../core/store';

export const CALCULATE_IMPACT_COMMAND = 'agentGraph.calculateImpact';

export type ImpactSource = 'git' | 'activeFile' | 'none';

export interface FileImpact {
	filePath: string;
	dependencies: string[];
	consumers: string[];
	relatedTests: string[];
}

export interface CalculateImpactOptions {
	/** Workspace folder the Project Graph was built from. */
	rootDir: string;
	/** Project Graph database to read. Left in-memory-only when omitted (e.g. tests). */
	dbPath?: string;
	/** Active editor's file, used as the analysis target when there are no uncommitted git changes (or vscode.git is unavailable). */
	activeFilePath?: string;
	/** Reused across calls so its short cache (Epic 8, task 2) actually saves a `git status` round trip; a call-scoped one is created otherwise. */
	gitStatus?: GitStatusSource;
	/** Reports each stage of the calculation, e.g. for a `vscode.window.withProgress` notification. */
	onProgress?: (message: string) => void;
}

export interface CalculateImpactResult {
	/** Where the target file set came from: the workspace's uncommitted git changes, a fallback to the active editor's file, or neither being available. */
	source: ImpactSource;
	/** Files the impact was calculated for. */
	targets: string[];
	/** Per-target dependency/consumer/test breakdown. */
	impacts: FileImpact[];
	/** Union of every target's consumers, transitively, minus the targets themselves — i.e. what changing the targets would affect. */
	impactedFiles: string[];
	/** Union of the tests related to the targets and to `impactedFiles`. */
	relatedTests: string[];
}

const EMPTY_TAIL: Pick<CalculateImpactResult, 'targets' | 'impacts' | 'impactedFiles' | 'relatedTests'> = {
	targets: [],
	impacts: [],
	impactedFiles: [],
	relatedTests: []
};

/**
 * Computes what a set of changed files would structurally impact: their
 * transitive consumers (Epic 8, task 1) and the tests related to either the
 * changed files or those consumers (task 4, built on task 2's test<->code
 * relation). The target set defaults to the workspace's uncommitted git
 * changes (task 3) that are also present in the Project Graph; when there
 * are none, it falls back to `activeFilePath` so the command stays useful on
 * a clean working tree.
 *
 * Kept free of any `vscode` dependency, like `analyzeWorkspace.ts`, so it can
 * be exercised directly in tests; the command registered in `extension.ts` is
 * a thin wrapper that resolves `rootDir`/`activeFilePath` and presents the
 * result.
 */
export async function calculateImpact(options: CalculateImpactOptions): Promise<CalculateImpactResult> {
	const { rootDir, dbPath, activeFilePath, onProgress } = options;
	const gitStatus = options.gitStatus ?? new GitStatusProvider();

	const store = await ProjectGraphStore.open({ filePath: dbPath });
	try {
		const knownFilesByResolvedPath = new Map(
			store
				.listNodes({ kind: 'file' })
				.filter((node) => node.filePath)
				.map((node) => [path.resolve(node.filePath as string), node.filePath as string])
		);

		onProgress?.('Reading git status...');
		const gitTargets = (await gitStatus.getChangedFiles(rootDir))
			.map((filePath) => knownFilesByResolvedPath.get(path.resolve(filePath)))
			.filter((filePath): filePath is string => Boolean(filePath));

		const { source, targets } = resolveTargets(gitTargets, activeFilePath, knownFilesByResolvedPath);
		if (targets.length === 0) {
			return { source, ...EMPTY_TAIL };
		}

		onProgress?.('Calculating structural impact...');
		const impacts = targets.map((filePath) => buildFileImpact(store, filePath));

		const targetSet = new Set(targets.map((filePath) => path.resolve(filePath)));
		const impactedFiles = [...new Set(impacts.flatMap((impact) => impact.consumers))].filter(
			(filePath) => !targetSet.has(path.resolve(filePath))
		);

		onProgress?.('Finding related tests...');
		const relatedTests = new Set<string>();
		for (const impact of impacts) {
			impact.relatedTests.forEach((testPath) => relatedTests.add(testPath));
		}
		for (const filePath of impactedFiles) {
			findRelatedTestFiles(store, filePath).forEach((testPath) => relatedTests.add(testPath));
		}

		return { source, targets, impacts, impactedFiles, relatedTests: [...relatedTests] };
	} finally {
		store.close();
	}
}

function resolveTargets(
	gitTargets: string[],
	activeFilePath: string | undefined,
	knownFilesByResolvedPath: Map<string, string>
): { source: ImpactSource; targets: string[] } {
	if (gitTargets.length > 0) {
		return { source: 'git', targets: gitTargets };
	}

	const knownActiveFile = activeFilePath ? knownFilesByResolvedPath.get(path.resolve(activeFilePath)) : undefined;
	if (knownActiveFile) {
		return { source: 'activeFile', targets: [knownActiveFile] };
	}

	return { source: 'none', targets: [] };
}

function buildFileImpact(store: ProjectGraphStore, filePath: string): FileImpact {
	const toFilePaths = (nodes: ReturnType<typeof getStructuralDependenciesForFile>): string[] =>
		nodes.map((node) => node.filePath).filter((candidate): candidate is string => Boolean(candidate));

	return {
		filePath,
		dependencies: toFilePaths(getStructuralDependenciesForFile(store, filePath)),
		consumers: toFilePaths(getStructuralConsumersForFile(store, filePath)),
		relatedTests: findRelatedTestFiles(store, filePath)
	};
}
