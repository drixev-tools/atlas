// "What leads to this file, and what it leads to" — a file-level subgraph
// built purely from `imports` edges (never `calls`/`extends`/etc.), for the
// active-file flow view (../ui/activeFileFlowPanel). Unlike the old
// calls-based entry-point flow, there's no picker here: the file whose flow
// this traces is always whatever's open in the editor.
import { StoredEdge, StoredGraph, StoredNode } from './store';

export interface ActiveFileFlow {
	activeFileId: string;
	nodes: StoredNode[];
	edges: StoredEdge[];
	/** `activeFileId` plus every file that (transitively) imports it — the upstream chain the view highlights as "the flow leading to this file". */
	highlightedIds: Set<string>;
	/** Highlighted files with no importer of their own — where the flow actually starts. */
	rootIds: Set<string>;
}

function pushInto(map: Map<string, string[]>, key: string, value: string): void {
	const existing = map.get(key);
	if (existing) {
		existing.push(value);
	} else {
		map.set(key, [value]);
	}
}

/**
 * Builds `activeFileId`'s flow from `graph`: every file that transitively
 * imports it (unbounded, cycle-safe the same way a visited set always is),
 * plus the files it directly imports itself (one hop only — enough to notify
 * the view of them without pulling in the whole dependency subtree). Only
 * `imports` edges whose target resolves to a `file` node count; the
 * finer-grained edges the extraction pipelines also emit for individual
 * imported symbols are ignored, since this view is about file-to-file flow.
 * Returns `undefined` when `activeFileId` isn't a file node in `graph`.
 */
export function buildActiveFileFlow(graph: StoredGraph, activeFileId: string): ActiveFileFlow | undefined {
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
	if (nodeById.get(activeFileId)?.kind !== 'file') {
		return undefined;
	}

	const fileImportEdges = graph.edges.filter((edge) => edge.kind === 'imports' && nodeById.get(edge.target)?.kind === 'file');
	const importersByFile = new Map<string, string[]>();
	const importsByFile = new Map<string, string[]>();
	for (const edge of fileImportEdges) {
		pushInto(importersByFile, edge.target, edge.source);
		pushInto(importsByFile, edge.source, edge.target);
	}

	const highlightedIds = new Set<string>([activeFileId]);
	const rootIds = new Set<string>();
	let frontier = [activeFileId];
	while (frontier.length > 0) {
		const next: string[] = [];
		for (const fileId of frontier) {
			const importers = importersByFile.get(fileId) ?? [];
			if (importers.length === 0) {
				rootIds.add(fileId);
			}
			for (const importerId of importers) {
				if (!highlightedIds.has(importerId)) {
					highlightedIds.add(importerId);
					next.push(importerId);
				}
			}
		}
		frontier = next;
	}

	const directImportIds = importsByFile.get(activeFileId) ?? [];
	const includedIds = new Set<string>([...highlightedIds, ...directImportIds]);

	const nodes = [...includedIds].map((id) => nodeById.get(id)).filter((node): node is StoredNode => node !== undefined);
	const edges = fileImportEdges.filter((edge) => includedIds.has(edge.source) && includedIds.has(edge.target));

	return { activeFileId, nodes, edges, highlightedIds, rootIds };
}
