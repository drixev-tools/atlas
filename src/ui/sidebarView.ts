// The pure file/symbol tree-building logic lives in ./sidebarData; this
// module owns everything `vscode`-specific: `TreeItem` rendering, the
// `TreeView` itself, and syncing a click to the editor and to whichever
// `GraphPanel` (./graphPanel) is currently open.
import * as vscode from 'vscode';
import { NodeKind } from '../pipelines/model';
import { ProjectGraphStore, StoredNode } from '../core/store';
import { ANALYZE_WORKSPACE_COMMAND } from './analyzeWorkspace';
import { CALCULATE_IMPACT_COMMAND } from './impact';
import { OPEN_ARCHITECTURE_COMMAND } from './architecture';
import { GraphPanel } from './graphPanel';
import { buildProjectFileTree, SidebarTreeNode } from './sidebarData';

export const SIDEBAR_VIEW_ID = 'agentGraph.explorer';
export const REFRESH_SIDEBAR_COMMAND = 'agentGraph.sidebar.refresh';
export const SELECT_SIDEBAR_NODE_COMMAND = 'agentGraph.sidebar.selectNode';

interface ShortcutElement {
	kind: 'shortcut';
	label: string;
	commandId: string;
	icon: string;
}

type TreeElement = ShortcutElement | SidebarTreeNode;

const SHORTCUTS: ShortcutElement[] = [
	{ kind: 'shortcut', label: 'Analyze Workspace', commandId: ANALYZE_WORKSPACE_COMMAND, icon: 'sync' },
	{ kind: 'shortcut', label: 'Open Architecture', commandId: OPEN_ARCHITECTURE_COMMAND, icon: 'graph' },
	{ kind: 'shortcut', label: 'Calculate Impact', commandId: CALCULATE_IMPACT_COMMAND, icon: 'pulse' }
];

const ICON_BY_NODE_KIND: Record<NodeKind, string> = {
	file: 'file',
	module: 'symbol-namespace',
	externalModule: 'package',
	function: 'symbol-function',
	class: 'symbol-class',
	interface: 'symbol-interface',
	method: 'symbol-method',
	property: 'symbol-property',
	variable: 'symbol-variable',
	enum: 'symbol-enum',
	typeAlias: 'symbol-type-parameter'
};

export interface SidebarOptions {
	/** Workspace folder the Project Graph was built from, used to display file paths relative to it. Undefined when no folder is open. */
	rootDir: string | undefined;
	/** Project Graph database to read. Left in-memory-only (an always-empty tree) when omitted, matching the other commands' `dbPath` handling. */
	dbPath: string | undefined;
}

/**
 * `TreeDataProvider` backing the sidebar. Holds its own `ProjectGraphStore`
 * handle, separate from any command's own: sql.js is an in-memory database
 * loaded from and saved back to `dbPath` on each open/save (see
 * `core/database.ts`), not a shared connection, so seeing another command's
 * writes means reopening the file, not just re-querying.
 */
export class ProjectGraphTreeProvider implements vscode.TreeDataProvider<TreeElement>, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	private store: ProjectGraphStore | undefined;
	private tree: SidebarTreeNode[] = [];

	constructor(private readonly options: SidebarOptions) {}

	dispose(): void {
		this.changeEmitter.dispose();
		this.store?.close();
	}

	/** Reopens the Project Graph Core from disk and rebuilds the tree. */
	async refresh(): Promise<void> {
		const nextStore = await ProjectGraphStore.open({ filePath: this.options.dbPath });
		this.store?.close();
		this.store = nextStore;
		this.tree = buildProjectFileTree(nextStore.getGraph(), this.options.rootDir);
		this.changeEmitter.fire();
	}

	getTreeItem(element: TreeElement): vscode.TreeItem {
		if (element.kind === 'shortcut') {
			return this.shortcutTreeItem(element);
		}
		if (element.kind === 'folder') {
			return this.folderTreeItem(element);
		}
		return this.nodeTreeItem(element);
	}

	getChildren(element?: TreeElement): TreeElement[] {
		if (!element) {
			return [...SHORTCUTS, ...this.tree];
		}
		if (element.kind === 'shortcut') {
			return [];
		}
		return element.children;
	}

	private shortcutTreeItem(element: ShortcutElement): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon(element.icon);
		item.command = { command: element.commandId, title: element.label };
		item.contextValue = 'agentGraph.shortcut';
		return item;
	}

	private folderTreeItem(element: Extract<SidebarTreeNode, { kind: 'folder' }>): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
		item.iconPath = vscode.ThemeIcon.Folder;
		item.contextValue = 'agentGraph.folder';
		return item;
	}

	private nodeTreeItem(element: Extract<SidebarTreeNode, { kind: 'node' }>): vscode.TreeItem {
		const { node } = element;
		const collapsibleState = element.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
		const item = new vscode.TreeItem(node.name, collapsibleState);
		item.iconPath = new vscode.ThemeIcon(ICON_BY_NODE_KIND[node.kind] ?? 'symbol-misc');
		item.description = node.kind === 'file' ? undefined : node.kind;
		item.contextValue = `agentGraph.node.${node.kind}`;
		item.command = { command: SELECT_SIDEBAR_NODE_COMMAND, title: 'Open', arguments: [node] };
		if (node.filePath) {
			item.resourceUri = vscode.Uri.file(node.filePath);
			item.tooltip = node.filePath;
		}
		return item;
	}
}

/**
 * Clicking a tree item opens its file in the editor (revealing its exact
 * range for a symbol) and syncs selection into whichever `GraphPanel` is
 * currently open, via the same `postMessage` bridge `graphPanel.ts` uses for
 * its own graph updates. Opening the file is a no-op for a node with no
 * `filePath` (e.g. an external module); the graph panel sync still runs.
 */
export async function selectProjectGraphNode(node: StoredNode): Promise<void> {
	if (node.filePath) {
		const document = await vscode.workspace.openTextDocument(node.filePath);
		const selection = node.range
			? new vscode.Range(
					node.range.startLine - 1,
					node.range.startColumn - 1,
					node.range.endLine - 1,
					node.range.endColumn - 1
			  )
			: undefined;
		await vscode.window.showTextDocument(document, { preview: true, selection });
	}
	GraphPanel.selectNode(node.id);
}

export function registerSidebar(context: vscode.ExtensionContext, options: SidebarOptions): ProjectGraphTreeProvider {
	const provider = new ProjectGraphTreeProvider(options);
	const treeView = vscode.window.createTreeView(SIDEBAR_VIEW_ID, {
		treeDataProvider: provider,
		showCollapseAll: true
	});

	context.subscriptions.push(
		provider,
		treeView,
		vscode.commands.registerCommand(SELECT_SIDEBAR_NODE_COMMAND, selectProjectGraphNode),
		vscode.commands.registerCommand(REFRESH_SIDEBAR_COMMAND, () => provider.refresh())
	);

	void provider.refresh();

	return provider;
}
