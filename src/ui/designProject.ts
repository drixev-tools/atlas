// "Project Graph: Design Project" (Epic 9): lets a user describe intent for
// a new project/feature — structured fields plus free text (task 1, see
// `collectProjectIntent`) — and turns it into a Proposed Graph via Claude
// (tasks 2-4, see ../design). `designProject` is the pure orchestration the
// command (task 5, registered in ../extension.ts) wraps with progress
// reporting and error/completion messages, the same split ../ui/analyzeWorkspace
// and ../ui/impact use.
import * as vscode from 'vscode';
import { populateProposedGraph } from '../core/populate';
import { ProjectGraphStore } from '../core/store';
import { ClaudeDesignClient, ProjectIntent, ProjectStack, buildProposedGraph } from '../design';

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
	nodeCount: number;
	edgeCount: number;
}

/**
 * Asks Claude to propose an architecture for `intent` and replaces the
 * Project Graph store's Proposed Graph (only the `proposed_only` slice —
 * see `populateProposedGraph`) with the result. Kept free of any `vscode`
 * dependency, like `analyzeWorkspace.ts`, so it can be exercised directly in
 * tests with a fake `claudeClient`; the command registered in `extension.ts`
 * is a thin wrapper that collects `intent`, resolves the real API key and
 * Claude client, and presents the result.
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
		populateProposedGraph(store, proposedGraph);
		if (dbPath) {
			store.save(dbPath);
		}
		const stored = store.getGraph({ status: 'proposed_only' });
		return { nodeCount: stored.nodes.length, edgeCount: stored.edges.length };
	} finally {
		store.close();
	}
}

const STACK_OPTIONS: ReadonlyArray<vscode.QuickPickItem & { stack: ProjectStack }> = [
	{ label: 'TypeScript / JavaScript', stack: 'typescript' },
	{ label: 'Python', stack: 'python' },
	{ label: 'Mixed / other', stack: 'mixed' }
];

const USE_DESCRIPTION_ACTION = 'Use Description';
const CANCEL_ACTION = 'Cancel';

const DESCRIPTION_PLACEHOLDER = `<!--
Project Graph: Design Project

Describe, in your own words, what this project or feature should do: its
purpose, the main pieces you already have in mind, how they should fit
together, and anything else Claude should know before proposing an
architecture.

Delete this comment block, write your description below, then come back to
the notification and click "${USE_DESCRIPTION_ACTION}".
-->
`;

/**
 * The intent form (Epic 9, task 1): a project/feature name and primary
 * stack via QuickInput, optional key components as a short structured
 * field, and a free-text description composed in a scratch editor (VS
 * Code's input box is single-line, so a real editor is the only way to let
 * the user write more than one line). Returns `undefined` if the user
 * cancels at any step.
 */
export async function collectProjectIntent(): Promise<ProjectIntent | undefined> {
	const name = await vscode.window.showInputBox({
		title: 'Project Graph: Design Project (1/4)',
		prompt: 'Name of the project or feature you want to design',
		ignoreFocusOut: true,
		validateInput: (value) => (value.trim().length === 0 ? 'A name is required.' : undefined)
	});
	if (!name) {
		return undefined;
	}

	const stackPick = await vscode.window.showQuickPick(STACK_OPTIONS, {
		title: 'Project Graph: Design Project (2/4)',
		placeHolder: 'Primary language/stack',
		ignoreFocusOut: true
	});
	if (!stackPick) {
		return undefined;
	}

	const keyComponentsInput = await vscode.window.showInputBox({
		title: 'Project Graph: Design Project (3/4)',
		prompt: 'Key components/modules you already have in mind, comma-separated (optional)',
		ignoreFocusOut: true
	});
	if (keyComponentsInput === undefined) {
		return undefined;
	}

	const description = await collectFreeTextDescription();
	if (description === undefined) {
		return undefined;
	}

	return {
		name: name.trim(),
		stack: stackPick.stack,
		keyComponents: keyComponentsInput
			.split(',')
			.map((component) => component.trim())
			.filter((component) => component.length > 0),
		description
	};
}

async function collectFreeTextDescription(): Promise<string | undefined> {
	const document = await vscode.workspace.openTextDocument({ content: DESCRIPTION_PLACEHOLDER, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });

	const choice = await vscode.window.showInformationMessage(
		'Project Graph: Design Project (4/4) — describe your intent in the editor that just opened, then come back here.',
		USE_DESCRIPTION_ACTION,
		CANCEL_ACTION
	);
	if (choice !== USE_DESCRIPTION_ACTION) {
		return undefined;
	}

	const description = document.getText().replace(DESCRIPTION_PLACEHOLDER, '').trim();
	if (!description) {
		void vscode.window.showErrorMessage('Project Graph: a description is required to design a proposed architecture.');
		return undefined;
	}
	return description;
}
