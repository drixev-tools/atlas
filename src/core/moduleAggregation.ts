// Folder/module-level `DiagramModel`: collapses every file (and everything
// it contains) into the folder it lives under, up to a configurable depth,
// for the layered-architecture view and diagram export planned for Fase
// 1.3. Built directly from a `StoredGraph`, like ./diagramModel, so it never
// depends on a live `ProjectGraphStore` or on React Flow.
import * as path from 'path';
import { DiagramModel, DiagramModelResult, DiagramNode, aggregateEdgesByEndpoint } from './diagramModel';
import { StoredGraph, StoredNode } from './store';

export interface FolderAggregationOptions {
	/** Workspace root file paths are grouped relative to. Falls back to grouping by each file's own absolute path when a file falls outside it. */
	rootDir?: string;
	/** How many folder levels below `rootDir` become their own group, e.g. `src/core/foo.ts` groups under `src/core` at depth 2. A file with fewer folder levels than `depth` groups at whatever depth it actually has. Clamped to at least 1. */
	depth: number;
}

const ROOT_GROUP_ID = 'group:.';
const ROOT_GROUP_LABEL = '(root)';

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

/** The chain of nested group ids/labels `filePath` belongs to, root-most first, capped at `depth` links; a file with no folder (living directly in `rootDir`) gets the single synthetic `ROOT_GROUP_ID` link. */
function groupChainForFile(filePath: string, rootDir: string | undefined, depth: number): GroupChainLink[] {
	const segments = folderSegmentsForFile(filePath, rootDir).slice(0, depth);
	if (segments.length === 0) {
		return [{ id: ROOT_GROUP_ID, label: ROOT_GROUP_LABEL }];
	}

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
 * is nesting only, with no metrics of its own.
 */
export function aggregateDiagramModelByFolder(graph: StoredGraph, options: FolderAggregationOptions): DiagramModelResult {
	const depth = Math.max(1, Math.floor(options.depth));
	const rootDir = options.rootDir;

	const groupById = new Map<string, DiagramNode>();
	const filePathsByGroupId = new Map<string, string[]>();
	const groupIdByFileId = new Map<string, string>();

	for (const node of graph.nodes) {
		if (node.kind !== 'file' || !node.filePath) {
			continue;
		}

		const chain = groupChainForFile(node.filePath, rootDir, depth);
		chain.forEach((link, index) => {
			if (!groupById.has(link.id)) {
				groupById.set(link.id, { id: link.id, kind: 'group', label: link.label, parentId: index > 0 ? chain[index - 1].id : undefined });
			}
		});

		const leafGroupId = chain[chain.length - 1].id;
		groupIdByFileId.set(node.id, leafGroupId);
		const filePaths = filePathsByGroupId.get(leafGroupId);
		if (filePaths) {
			filePaths.push(node.filePath);
		} else {
			filePathsByGroupId.set(leafGroupId, [node.filePath]);
		}
	}

	const fileIdByResolvedPath = new Map<string, string>();
	for (const node of graph.nodes) {
		if (node.kind === 'file' && node.filePath) {
			fileIdByResolvedPath.set(path.resolve(node.filePath), node.id);
		}
	}

	const groupIdByNodeId = new Map<string, string>();
	for (const node of graph.nodes) {
		if (node.kind === 'externalModule') {
			continue;
		}
		const fileId = node.kind === 'file' ? node.id : node.filePath ? fileIdByResolvedPath.get(path.resolve(node.filePath)) : undefined;
		const groupId = fileId ? groupIdByFileId.get(fileId) : undefined;
		if (groupId) {
			groupIdByNodeId.set(node.id, groupId);
		}
	}

	const edges = aggregateEdgesByEndpoint(
		graph.edges.filter((edge) => edge.kind !== 'contains'),
		(nodeId) => groupIdByNodeId.get(nodeId)
	);

	const model: DiagramModel = { nodes: [...groupById.values()], edges };
	return { model, filePathsByNodeId: filePathsByGroupId };
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
