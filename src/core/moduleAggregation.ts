// Folder/module-level `DiagramModel`: collapses every file (and everything
// it contains) into the folder it lives under, up to a configurable depth,
// for the layered-architecture view and diagram export planned for Fase
// 1.3. Built directly from a `StoredGraph`, like ./diagramModel, so it never
// depends on a live `AtlasStore` or on React Flow.
import * as path from 'path';
import { DiagramModel, DiagramModelResult, DiagramNode, aggregateEdgesByEndpoint } from './diagramModel';
import { StoredGraph, StoredNode } from './store';

export interface FolderAggregationOptions {
	/** Workspace root file paths are grouped relative to. Falls back to grouping by each file's own absolute path when a file falls outside it. */
	rootDir?: string;
	/** How many folder levels below `rootDir` become their own group, e.g. `src/core/foo.ts` groups under `src/core` at depth 2. A file with fewer folder levels than `depth` groups at whatever depth it actually has. Clamped to at least 1. */
	depth: number;
}

function pathSegments(value: string): string[] {
	return value.split(/[\\/]/).filter(Boolean);
}

function folderSegmentsForFile(filePath: string, rootDir: string | undefined): string[] {
	const segments = (() => {
		if (!rootDir) {
			return pathSegments(filePath);
		}
		const relative = path.relative(rootDir, filePath);
		if (!relative || relative.startsWith('..')) {
			return pathSegments(filePath);
		}
		return pathSegments(relative);
	})();
	return segments.slice(0, -1);
}

interface GroupChainLink {
	id: string;
	label: string;
}

/**
 * Folds a group that owns no files of its own and nests exactly one child
 * group into that child — repeatedly, so a chain of several such pass-through
 * folders (e.g. `backend/src/core`, if neither `backend` nor `src` ever holds
 * a file directly) collapses to one node labelled with the full folder path
 * instead of a tower of boxes that separate nothing. A group with its own
 * files, or with more than one child, stays put: only a folder that is pure
 * nesting is redundant.
 */
function collapseSingleChildGroups(groupById: Map<string, DiagramNode>, filePathsByNodeId: Map<string, string[]>): void {
	let changed = true;
	while (changed) {
		changed = false;
		const childCountByParentId = new Map<string, number>();
		for (const group of groupById.values()) {
			if (group.parentId) {
				childCountByParentId.set(group.parentId, (childCountByParentId.get(group.parentId) ?? 0) + 1);
			}
		}

		for (const group of groupById.values()) {
			const parent = group.parentId ? groupById.get(group.parentId) : undefined;
			if (!parent || filePathsByNodeId.has(parent.id) || childCountByParentId.get(parent.id) !== 1) {
				continue;
			}
			groupById.set(group.id, { ...group, label: `${parent.label}/${group.label}`, parentId: parent.parentId });
			groupById.delete(parent.id);
			changed = true;
			break;
		}
	}
}

/** The chain of nested group ids/labels `segments` (a file's folder path, already capped at `depth`) belongs to, root-most first. Always non-empty — a file with no folder never reaches this; see `aggregateDiagramModelByFolder`'s own root-level handling. */
function groupChainForSegments(segments: readonly string[]): GroupChainLink[] {
	const chain: GroupChainLink[] = [];
	let accumulatedPath = '';
	for (const segment of segments) {
		accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
		chain.push({ id: `group:${accumulatedPath}`, label: segment });
	}
	return chain;
}

/**
 * Groups `graph`'s `file` nodes (and everything they `contains`) into nested
 * folder/module groups up to `options.depth` levels below `options.rootDir`,
 * aggregating every non-`contains` edge between two groups into one
 * `DiagramEdge` per group pair (`aggregateEdgesByEndpoint`, from
 * ./diagramModel). Edges touching an `externalModule` node are dropped from
 * the result — `computeDiagramMetrics` (./diagramMetrics) tallies those
 * separately as a group's `externalDependencies`, since an external
 * dependency is a metric here, not a graph edge. Only the leaf group at
 * `depth` gets an entry in `filePathsByNodeId`; an intermediate folder level
 * is nesting only, with no metrics of its own — and if it nests nothing but
 * that one leaf, `collapseSingleChildGroups` folds it away entirely rather
 * than rendering a box that separates nothing (e.g. a monorepo's per-package
 * `src` folder under `backend`/`frontend`).
 *
 * A file with no folder at all (living directly in `rootDir`) never gets a
 * synthetic wrapper group — it becomes its own top-level `file` `DiagramNode`
 * instead, a sibling of the depth-1 folder groups. The architecture view
 * (../ui/architectureLayers) renders these, like every depth-1 node, as
 * visible by default; a folder's own member files only ever surface once the
 * user expands that folder (../ui/diagramFileExpansion's containment-based
 * hiding, not something this pure model-building step needs to know about).
 */
export function aggregateDiagramModelByFolder(graph: StoredGraph, options: FolderAggregationOptions): DiagramModelResult {
	const depth = Math.max(1, Math.floor(options.depth));
	const rootDir = options.rootDir;

	const groupById = new Map<string, DiagramNode>();
	const rootFileById = new Map<string, DiagramNode>();
	const filePathsByNodeId = new Map<string, string[]>();
	const resolvedIdByFileId = new Map<string, string>();

	for (const node of graph.nodes) {
		if (node.kind !== 'file' || !node.filePath) {
			continue;
		}

		const segments = folderSegmentsForFile(node.filePath, rootDir);
		if (segments.length === 0) {
			rootFileById.set(node.id, { id: node.id, kind: 'file', label: node.name });
			resolvedIdByFileId.set(node.id, node.id);
			filePathsByNodeId.set(node.id, [node.filePath]);
			continue;
		}

		const chain = groupChainForSegments(segments.slice(0, depth));
		chain.forEach((link, index) => {
			if (!groupById.has(link.id)) {
				groupById.set(link.id, { id: link.id, kind: 'group', label: link.label, parentId: index > 0 ? chain[index - 1].id : undefined });
			}
		});

		const leafGroupId = chain[chain.length - 1].id;
		resolvedIdByFileId.set(node.id, leafGroupId);
		const filePaths = filePathsByNodeId.get(leafGroupId);
		if (filePaths) {
			filePaths.push(node.filePath);
		} else {
			filePathsByNodeId.set(leafGroupId, [node.filePath]);
		}
	}

	collapseSingleChildGroups(groupById, filePathsByNodeId);

	const fileIdByResolvedPath = new Map<string, string>();
	for (const node of graph.nodes) {
		if (node.kind === 'file' && node.filePath) {
			fileIdByResolvedPath.set(path.resolve(node.filePath), node.id);
		}
	}

	const resolvedIdByNodeId = new Map<string, string>();
	for (const node of graph.nodes) {
		if (node.kind === 'externalModule') {
			continue;
		}
		const fileId = node.kind === 'file' ? node.id : node.filePath ? fileIdByResolvedPath.get(path.resolve(node.filePath)) : undefined;
		const resolvedId = fileId ? resolvedIdByFileId.get(fileId) : undefined;
		if (resolvedId) {
			resolvedIdByNodeId.set(node.id, resolvedId);
		}
	}

	const edges = aggregateEdgesByEndpoint(
		graph.edges.filter((edge) => edge.kind !== 'contains'),
		(nodeId) => resolvedIdByNodeId.get(nodeId)
	);

	const model: DiagramModel = { nodes: [...groupById.values(), ...rootFileById.values()], edges };
	return { model, filePathsByNodeId };
}

/**
 * File-level `DiagramModel` for the architecture view's "files" drill-down:
 * one `DiagramNode` per `file` node in `filePaths` (every file when omitted),
 * with every other node resolved up to the file it belongs to before
 * `aggregateEdgesByEndpoint` collapses edges onto file-to-file pairs — the
 * same "resolve every node to a coarser id, then aggregate" shape
 * `aggregateDiagramModelByFolder` uses for folders, one level shallower.
 * `externalModule` nodes are excluded the same way, tallied instead as a
 * file's `externalDependencies` metric.
 */
export function aggregateDiagramModelByFile(graph: StoredGraph, filePaths?: ReadonlySet<string>): DiagramModelResult {
	const fileNodes = graph.nodes.filter(
		(node): node is DiagramFileNode => node.kind === 'file' && Boolean(node.filePath) && (!filePaths || filePaths.has(node.filePath as string))
	);

	const fileIdByPath = new Map(fileNodes.map((node) => [node.filePath, node.id]));

	const fileIdByNodeId = new Map<string, string>();
	for (const node of graph.nodes) {
		if (node.kind === 'externalModule' || !node.filePath) {
			continue;
		}
		const fileId = fileIdByPath.get(node.filePath);
		if (fileId) {
			fileIdByNodeId.set(node.id, fileId);
		}
	}

	const edges = aggregateEdgesByEndpoint(
		graph.edges.filter((edge) => edge.kind !== 'contains'),
		(nodeId) => fileIdByNodeId.get(nodeId)
	);

	const nodes: DiagramNode[] = fileNodes.map((node) => ({ id: node.id, kind: node.kind, label: node.name, filePath: node.filePath }));
	const filePathsByNodeId = new Map<string, readonly string[]>(fileNodes.map((node) => [node.id, [node.filePath]]));

	return { model: { nodes, edges }, filePathsByNodeId };
}

type DiagramFileNode = StoredNode & { filePath: string };
