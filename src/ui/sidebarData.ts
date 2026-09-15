// Pure mapping from the Project Graph Core's stored shape to the sidebar's
// file/module/symbol navigation tree (Fase 1.1, Epic A). Kept free of any
// `vscode` dependency, like `graphData.ts`, so it can be unit tested directly
// against `StoredGraph` fixtures; `sidebarView.ts` wraps this in a
// `vscode.TreeDataProvider`.
//
// The extraction pipelines don't currently emit a `module` node kind (see
// `pipelines/model.ts`), so "modules" in the tree are the directories a
// file's path is nested under, built from `file` nodes' paths rather than
// from graph data — the closest available proxy for a project's module
// structure. Symbols nested inside a file (and inside each other, e.g. a
// class's methods) come from `contains` edges, which the pipelines already
// produce for exactly this hierarchy.
import * as path from 'path';
import { StoredGraph, StoredNode } from '../core/store';

export interface FolderTreeNode {
	kind: 'folder';
	label: string;
	/** Path from the tree root to this folder, `/`-joined regardless of OS, unique across the whole tree. */
	path: string;
	children: SidebarTreeNode[];
}

export interface FileOrSymbolTreeNode {
	kind: 'node';
	node: StoredNode;
	/** Symbols directly contained by this node (a file's top-level symbols, or a class/interface's members), via `contains` edges. */
	children: SidebarTreeNode[];
}

export type SidebarTreeNode = FolderTreeNode | FileOrSymbolTreeNode;

function pathSegments(filePath: string): string[] {
	return filePath.split(/[\\/]/).filter(Boolean);
}

/** `filePath`'s segments relative to `rootDir`, falling back to the absolute path's own segments when there's no root or the file falls outside it. */
function relativeSegments(filePath: string, rootDir: string | undefined): string[] {
	if (!rootDir) {
		return pathSegments(filePath);
	}
	const relative = path.relative(rootDir, filePath);
	if (!relative || relative.startsWith('..')) {
		return pathSegments(filePath);
	}
	return pathSegments(relative);
}

function indexContainedChildren(graph: StoredGraph): Map<string, StoredNode[]> {
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
	const childrenByContainer = new Map<string, StoredNode[]>();
	for (const edge of graph.edges) {
		if (edge.kind !== 'contains') {
			continue;
		}
		const target = nodeById.get(edge.target);
		if (!target) {
			continue;
		}
		const existing = childrenByContainer.get(edge.source);
		if (existing) {
			existing.push(target);
		} else {
			childrenByContainer.set(edge.source, [target]);
		}
	}
	return childrenByContainer;
}

/** Symbols nested directly under `containerId` (a file or another symbol, e.g. a class), in source order, recursing through their own `contains` children. */
function symbolChildren(containerId: string, childrenByContainer: Map<string, StoredNode[]>): SidebarTreeNode[] {
	const children = childrenByContainer.get(containerId) ?? [];
	return sortBySourceOrder(children).map((node) => ({
		kind: 'node',
		node,
		children: symbolChildren(node.id, childrenByContainer)
	}));
}

function sortBySourceOrder(nodes: StoredNode[]): StoredNode[] {
	return [...nodes].sort((a, b) => {
		const lineA = a.range?.startLine ?? Number.MAX_SAFE_INTEGER;
		const lineB = b.range?.startLine ?? Number.MAX_SAFE_INTEGER;
		return lineA - lineB || a.name.localeCompare(b.name);
	});
}

function sortFileSystemLevel(nodes: SidebarTreeNode[]): SidebarTreeNode[] {
	nodes.sort((a, b) => {
		if (a.kind !== b.kind) {
			return a.kind === 'folder' ? -1 : 1;
		}
		const labelA = a.kind === 'folder' ? a.label : a.node.name;
		const labelB = b.kind === 'folder' ? b.label : b.node.name;
		return labelA.localeCompare(labelB);
	});
	for (const node of nodes) {
		if (node.kind === 'folder') {
			sortFileSystemLevel(node.children);
		}
	}
	return nodes;
}

/**
 * The sidebar's root-level tree: `file` nodes grouped into the directories
 * they live under (relative to `rootDir` when given), each file expanding
 * into the symbols it `contains`, recursively. Folders sort before files,
 * both alphabetically; symbols sort by their position in the source file.
 */
export function buildProjectFileTree(graph: StoredGraph, rootDir?: string): SidebarTreeNode[] {
	const childrenByContainer = indexContainedChildren(graph);
	const foldersByPath = new Map<string, FolderTreeNode>();
	const roots: SidebarTreeNode[] = [];

	function folderFor(parentChildren: SidebarTreeNode[], folderPath: string, label: string): FolderTreeNode {
		const existing = foldersByPath.get(folderPath);
		if (existing) {
			return existing;
		}
		const folder: FolderTreeNode = { kind: 'folder', label, path: folderPath, children: [] };
		foldersByPath.set(folderPath, folder);
		parentChildren.push(folder);
		return folder;
	}

	for (const fileNode of graph.nodes.filter((node): node is StoredNode & { filePath: string } => node.kind === 'file' && Boolean(node.filePath))) {
		const segments = relativeSegments(fileNode.filePath, rootDir);
		let children = roots;
		let folderPath = '';
		for (const segment of segments.slice(0, -1)) {
			folderPath = folderPath ? `${folderPath}/${segment}` : segment;
			children = folderFor(children, folderPath, segment).children;
		}
		children.push({ kind: 'node', node: fileNode, children: symbolChildren(fileNode.id, childrenByContainer) });
	}

	return sortFileSystemLevel(roots);
}

export function isFolderNode(node: SidebarTreeNode): node is FolderTreeNode {
	return node.kind === 'folder';
}
