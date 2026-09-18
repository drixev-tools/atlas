import * as path from 'path';
import { CodeGraph } from '../pipelines/model';
import { DEFAULT_GRAPH_STATUS, GraphStatus } from './schema';
import { AtlasStore } from './store';

/**
 * Both pipelines id a file node as `file:${path.resolve(filePath)}` (see
 * each pipeline's normalize.ts) but store the node's `filePath` field
 * verbatim from extraction, which is not always in that same resolved form
 * (the TS compiler API normalizes to forward slashes regardless of platform,
 * for instance). Looking the file node up by id first, then reading back
 * its stored `filePath`, is what lets `listNodes({ filePath })` reliably
 * find the rest of that file's nodes (its symbols share the exact same
 * string) regardless of which separator style produced it.
 */
function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

/**
 * Absolute paths of every file the store currently has a 'file' node for.
 * Pass this as `knownFiles` to `runTsPipeline`/`runPythonPipeline` when
 * (re-)extracting a single changed file, so its imports to sibling files
 * still resolve to their file node instead of collapsing into an
 * external-module node just because those siblings aren't being re-parsed.
 */
export function knownProjectFiles(store: AtlasStore): string[] {
	return store
		.listNodes({ kind: 'file' })
		.map((node) => node.filePath)
		.filter((filePath): filePath is string => Boolean(filePath));
}

export interface ApplyFileGraphOptions {
	status?: GraphStatus;
}

/**
 * Replaces one file's slice of the Atlas graph with a freshly
 * (re-)extracted `CodeGraph` for that file alone, without touching any other
 * file's nodes/edges and without re-running the rest of the pipeline. Used
 * for both a newly created file and a modified one.
 *
 * The file's previous nodes (itself plus its symbols) and the edges they
 * owned (contains/exports/imports edges sourced from one of those nodes) are
 * diffed against the new extraction: anything no longer present is deleted,
 * everything the new extraction produced is upserted. Edges other files hold
 * that merely point *at* this file (e.g. another file's `imports` edge) are
 * left alone here; they cascade-delete automatically if this file is later
 * removed (see `removeFileGraph`) and are otherwise that other file's to own.
 */
export function applyFileGraph(
	store: AtlasStore,
	filePath: string,
	graph: CodeGraph,
	options: ApplyFileGraphOptions = {}
): void {
	const status = options.status ?? DEFAULT_GRAPH_STATUS;
	const existingFileNode = store.getNode(fileNodeId(filePath));

	const staleNodeIds = new Set(
		existingFileNode ? store.listNodes({ filePath: existingFileNode.filePath }).map((node) => node.id) : []
	);
	const staleEdgeIds = new Set<string>();
	for (const nodeId of staleNodeIds) {
		for (const edge of store.getEdgesForNode(nodeId, 'out')) {
			staleEdgeIds.add(edge.id);
		}
	}

	const nextNodeIds = new Set(graph.nodes.map((node) => node.id));
	const nextEdgeIds = new Set(graph.edges.map((edge) => edge.id));

	for (const edgeId of staleEdgeIds) {
		if (!nextEdgeIds.has(edgeId)) {
			store.deleteEdge(edgeId);
		}
	}
	for (const nodeId of staleNodeIds) {
		if (!nextNodeIds.has(nodeId)) {
			store.deleteNode(nodeId);
		}
	}

	store.upsertNodes(graph.nodes, status);
	store.upsertEdges(graph.edges, status);
}

/**
 * Removes a deleted file's nodes (itself plus its symbols) from the Project
 * Graph. Edges other files still hold pointing at this file (e.g. an
 * `imports` edge whose target no longer exists) cascade-delete with it via
 * the `ON DELETE CASCADE` foreign keys in the schema, so no orphaned edges
 * are left behind; re-resolving those other files' imports against whatever
 * replaces this file, if anything, happens the next time they're re-parsed.
 */
export function removeFileGraph(store: AtlasStore, filePath: string): void {
	const existingFileNode = store.getNode(fileNodeId(filePath));
	if (!existingFileNode) {
		return;
	}
	for (const node of store.listNodes({ filePath: existingFileNode.filePath })) {
		store.deleteNode(node.id);
	}
}
