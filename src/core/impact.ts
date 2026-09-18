// Structural impact analysis over the Atlas Core: given a node (or
// file), what it depends on and what depends on it, computed purely from the
// `imports` edges the extraction pipelines already produce. ./testLinks uses
// `getStructuralConsumersForFile` to find tests that reach a file indirectly.
import * as path from 'path';
import { AtlasStore, StoredNode } from './store';

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

export interface StructuralImpactOptions {
	/** Caps how many `imports` hops to follow. Unbounded (walks the whole reachable graph) when omitted. */
	maxDepth?: number;
}

/**
 * Nodes `nodeId` structurally depends on: every node reachable by following
 * outgoing `imports` edges, transitively. `nodeId` itself is never included.
 */
export function getStructuralDependencies(
	store: AtlasStore,
	nodeId: string,
	options: StructuralImpactOptions = {}
): StoredNode[] {
	return traverseImports(store, nodeId, 'out', options);
}

/**
 * Nodes that structurally depend on `nodeId` — i.e. what would be affected by
 * a change to it — found by following incoming `imports` edges, transitively.
 * `nodeId` itself is never included.
 */
export function getStructuralConsumers(
	store: AtlasStore,
	nodeId: string,
	options: StructuralImpactOptions = {}
): StoredNode[] {
	return traverseImports(store, nodeId, 'in', options);
}

/** `getStructuralDependencies`, starting from a file path instead of a raw node id. */
export function getStructuralDependenciesForFile(
	store: AtlasStore,
	filePath: string,
	options: StructuralImpactOptions = {}
): StoredNode[] {
	return getStructuralDependencies(store, fileNodeId(filePath), options);
}

/** `getStructuralConsumers`, starting from a file path instead of a raw node id. */
export function getStructuralConsumersForFile(
	store: AtlasStore,
	filePath: string,
	options: StructuralImpactOptions = {}
): StoredNode[] {
	return getStructuralConsumers(store, fileNodeId(filePath), options);
}

function traverseImports(
	store: AtlasStore,
	startId: string,
	direction: 'out' | 'in',
	options: StructuralImpactOptions
): StoredNode[] {
	const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
	const visited = new Set<string>([startId]);
	const result: StoredNode[] = [];
	let frontier = [startId];

	for (let depth = 0; frontier.length > 0 && depth < maxDepth; depth++) {
		const next: string[] = [];
		for (const id of frontier) {
			const edges = direction === 'out' ? store.listEdges({ kind: 'imports', source: id }) : store.listEdges({ kind: 'imports', target: id });
			for (const edge of edges) {
				const neighborId = direction === 'out' ? edge.target : edge.source;
				if (visited.has(neighborId)) {
					continue;
				}
				visited.add(neighborId);

				const node = store.getNode(neighborId);
				if (node) {
					result.push(node);
					next.push(neighborId);
				}
			}
		}
		frontier = next;
	}

	return result;
}
