// Turns a user's intent for a new project/feature into a Proposed Graph via
// Claude. `designProject` is the pure orchestration the sidebar's Design
// Project webview view (../ui/designProjectView) wraps with progress
// reporting and result presentation, the same split ../ui/analyzeWorkspace
// and ../ui/impact use. Updating the store also reconciles the new proposal
// against the Observed Graph already there (see ../core/comparison), so
// parts of it that already exist in the code come back tagged `matched`
// instead of `proposed_only`.
import { reconcileProposedGraph } from '../core/comparison';
import { ProjectGraphStore } from '../core/store';
import { ClaudeDesignClient, ProjectIntent, buildProposedGraph } from '../design';

export const DESIGN_PROJECT_COMMAND = 'agentGraph.designProject';

export interface DesignProjectOptions {
	/** Workspace folder the design is for; proposed file nodes are resolved relative to it (see ../design/proposedGraph). */
	rootDir: string;
	/** Project Graph database to update. Left in-memory-only when omitted (e.g. tests). */
	dbPath?: string;
	intent: ProjectIntent;
	claudeClient: ClaudeDesignClient;
	/** Reports each stage of the design, e.g. for a `vscode.window.withProgress` notification. */
	onProgress?: (message: string) => void;
}

export interface DesignProjectResult {
	/** Total nodes/edges in the proposal Claude returned, matched or not. */
	nodeCount: number;
	edgeCount: number;
	/** How many of those already exist in the Observed Graph. */
	matchedNodeCount: number;
	matchedEdgeCount: number;
}

/**
 * Asks Claude to propose an architecture for `intent`, replaces the Project
 * Graph store's Proposed Graph with the result, and reconciles it against
 * the Observed Graph already there (`reconcileProposedGraph`) so parts of
 * the proposal that already exist in the code are tagged `matched`
 * rather than `proposed_only`. Kept free of any `vscode` dependency, like
 * `analyzeWorkspace.ts`, so it can be exercised directly in tests with a
 * fake `claudeClient`; `DesignProjectViewProvider` (../ui/designProjectView)
 * is a thin wrapper that collects `intent` from its form, resolves the real
 * API key and Claude client, and presents the result.
 */
export async function designProject(options: DesignProjectOptions): Promise<DesignProjectResult> {
	const { rootDir, dbPath, intent, claudeClient, onProgress } = options;

	onProgress?.('Asking Claude to propose an architecture...');
	const architecture = await claudeClient.proposeArchitecture(intent);

	onProgress?.('Building Proposed Graph...');
	const proposedGraph = buildProposedGraph(rootDir, architecture);

	onProgress?.('Updating Project Graph...');
	const store = await ProjectGraphStore.open({ filePath: dbPath });
	try {
		const comparison = reconcileProposedGraph(store, proposedGraph);
		if (dbPath) {
			store.save(dbPath);
		}
		return {
			nodeCount: proposedGraph.nodes.length,
			edgeCount: proposedGraph.edges.length,
			matchedNodeCount: comparison.matchedNodeCount,
			matchedEdgeCount: comparison.matchedEdgeCount
		};
	} finally {
		store.close();
	}
}
