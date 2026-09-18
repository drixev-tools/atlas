import { populateProjectGraph } from '../core/populate';
import { ProjectGraphStore } from '../core/store';
import { runPythonPipeline } from '../pipelines/python';
import { runTsPipeline } from '../pipelines/ts';

export const ANALYZE_WORKSPACE_COMMAND = 'atlas.analyzeWorkspace';

export interface AnalyzeWorkspaceOptions {
	/** Workspace folder to run both extraction pipelines over. */
	rootDir: string;
	/** Where to persist the resulting Project Graph. Left in-memory-only when omitted (e.g. tests). */
	dbPath?: string;
	/** Reports each stage of the analysis, e.g. for a `vscode.window.withProgress` notification. */
	onProgress?: (message: string) => void;
}

export interface AnalyzeWorkspaceResult {
	nodeCount: number;
	edgeCount: number;
}

/**
 * Runs the TS/JS and Python extraction pipelines over `rootDir` and replaces
 * the Project Graph store's contents with their combined, de-duplicated
 * output (see `populateProjectGraph`). This is the full-rebuild counterpart
 * to the incremental updates `ProjectGraphWatcher` applies as files change,
 * and is what the "Atlas: Analyze Workspace" command runs.
 *
 * Kept free of any `vscode` dependency so it can be exercised directly in
 * tests; the command registered in `extension.ts` is a thin wrapper that
 * supplies progress reporting, the workspace folder, and error/completion
 * messages.
 */
export async function analyzeWorkspace(options: AnalyzeWorkspaceOptions): Promise<AnalyzeWorkspaceResult> {
	const { rootDir, dbPath, onProgress } = options;

	onProgress?.('Extracting TypeScript/JavaScript...');
	const tsGraph = runTsPipeline(rootDir);

	onProgress?.('Extracting Python...');
	const pythonGraph = await runPythonPipeline(rootDir);

	onProgress?.('Updating Project Graph...');
	const store = await ProjectGraphStore.open({ filePath: dbPath });
	try {
		populateProjectGraph(store, [tsGraph, pythonGraph]);
		if (dbPath) {
			store.save(dbPath);
		}
		const graph = store.getGraph();
		return { nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
	} finally {
		store.close();
	}
}
