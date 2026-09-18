// Per-node metrics for a `DiagramModel` (size, fan-in/fan-out, external
// dependencies, linked tests, and git status), computed against the same
// `StoredGraph` a `DiagramModelResult` (./diagramModel, ./moduleAggregation)
// was built from, plus the live `AtlasStore` `findRelatedTestFiles`
// (./testLinks) needs to walk `imports` edges. Works the same for a
// per-file model and a folder/module-aggregated one: the only thing a node
// needs to receive metrics is an entry in `filePathsByNodeId`.
import * as path from 'path';
import { DiagramExternalDependency, DiagramMetrics, DiagramModel, DiagramNodeFilePaths } from './diagramModel';
import { AtlasStore, StoredGraph } from './store';
import { findRelatedTestFiles } from './testLinks';

export interface ComputeDiagramMetricsOptions {
	/** Absolute paths of files with uncommitted git changes, for `DiagramMetrics.changedFileCount`. Treated as empty — every node reporting a clean working tree — when omitted. */
	changedFiles?: readonly string[];
}

function countDistinctNeighbors(
	model: DiagramModel,
	filePathsByNodeId: DiagramNodeFilePaths
): { fanIn: Map<string, number>; fanOut: Map<string, number> } {
	const outNeighbors = new Map<string, Set<string>>();
	const inNeighbors = new Map<string, Set<string>>();

	for (const edge of model.edges) {
		if (!filePathsByNodeId.has(edge.source) || !filePathsByNodeId.has(edge.target)) {
			continue;
		}
		const out = outNeighbors.get(edge.source) ?? new Set<string>();
		out.add(edge.target);
		outNeighbors.set(edge.source, out);

		const inbound = inNeighbors.get(edge.target) ?? new Set<string>();
		inbound.add(edge.source);
		inNeighbors.set(edge.target, inbound);
	}

	const toCounts = (byNodeId: Map<string, Set<string>>): Map<string, number> =>
		new Map([...byNodeId.entries()].map(([nodeId, neighbors]) => [nodeId, neighbors.size]));

	return { fanIn: toCounts(inNeighbors), fanOut: toCounts(outNeighbors) };
}

/** External dependencies of `memberNodeIds`: every non-`contains` edge from one of them to an `externalModule` node, tallied by that module's name. */
function externalDependenciesForMembers(graph: StoredGraph, memberNodeIds: ReadonlySet<string>): DiagramExternalDependency[] {
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
	const countByExternalName = new Map<string, number>();

	for (const edge of graph.edges) {
		if (edge.kind === 'contains' || !memberNodeIds.has(edge.source)) {
			continue;
		}
		const target = nodeById.get(edge.target);
		if (target?.kind !== 'externalModule') {
			continue;
		}
		countByExternalName.set(target.name, (countByExternalName.get(target.name) ?? 0) + 1);
	}

	return [...countByExternalName.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Metrics for every node `filePathsByNodeId` covers: `fileCount`/`symbolCount`
 * read straight off `graph`, `fanIn`/`fanOut` as the number of distinct other
 * measurable nodes `model.edges` connects it to (not the raw edge count —
 * two `calls` edges to the same neighbor count once), `externalDependencies`
 * from `graph`'s own edges to `externalModule` nodes (excluded from
 * `model.edges` by ./moduleAggregation, so they have to be read back from
 * `graph`), `testLinks` via `findRelatedTestFiles`, and `changedFileCount`
 * against `options.changedFiles`.
 */
export function computeDiagramMetrics(
	store: AtlasStore,
	graph: StoredGraph,
	model: DiagramModel,
	filePathsByNodeId: DiagramNodeFilePaths,
	options: ComputeDiagramMetricsOptions = {}
): Map<string, DiagramMetrics> {
	const changedFiles = new Set((options.changedFiles ?? []).map((filePath) => path.resolve(filePath)));
	const { fanIn, fanOut } = countDistinctNeighbors(model, filePathsByNodeId);

	const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
	const nodeIdsByFilePath = new Map<string, string[]>();
	for (const node of graph.nodes) {
		if (!node.filePath) {
			continue;
		}
		const ids = nodeIdsByFilePath.get(node.filePath);
		if (ids) {
			ids.push(node.id);
		} else {
			nodeIdsByFilePath.set(node.filePath, [node.id]);
		}
	}

	const metricsByNodeId = new Map<string, DiagramMetrics>();

	for (const [nodeId, filePaths] of filePathsByNodeId) {
		const memberNodeIds = new Set<string>();
		let symbolCount = 0;
		let changedFileCount = 0;
		const testLinks = new Set<string>();

		for (const filePath of filePaths) {
			if (changedFiles.has(path.resolve(filePath))) {
				changedFileCount++;
			}
			for (const memberId of nodeIdsByFilePath.get(filePath) ?? []) {
				memberNodeIds.add(memberId);
				if (nodeById.get(memberId)?.kind !== 'file') {
					symbolCount++;
				}
			}
			findRelatedTestFiles(store, filePath).forEach((testPath) => testLinks.add(testPath));
		}

		metricsByNodeId.set(nodeId, {
			fileCount: filePaths.length,
			symbolCount,
			fanIn: fanIn.get(nodeId) ?? 0,
			fanOut: fanOut.get(nodeId) ?? 0,
			externalDependencies: externalDependenciesForMembers(graph, memberNodeIds),
			testLinks: [...testLinks],
			changedFileCount
		});
	}

	return metricsByNodeId;
}

/** `model` with each node's `metrics` filled in from `metricsByNodeId`, leaving a node with no entry (e.g. a plain nesting group) untouched. */
export function attachDiagramMetrics(model: DiagramModel, metricsByNodeId: ReadonlyMap<string, DiagramMetrics>): DiagramModel {
	return {
		nodes: model.nodes.map((node) => {
			const metrics = metricsByNodeId.get(node.id);
			return metrics ? { ...node, metrics } : node;
		}),
		edges: model.edges
	};
}
