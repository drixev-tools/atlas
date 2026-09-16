// Pure diagram data model shared by every graph-based view (Explore's React
// Flow renderer today; the layered-architecture/flow/sequence views and
// diagram export planned for Fase 1.3) and by the folder/module aggregation
// in ./moduleAggregation: independent of any rendering library, built
// directly from a `StoredGraph`. `contains` edges never appear in
// `DiagramModel.edges` — they become `DiagramNode.parentId` nesting instead,
// the shape a renderer's parent/child groups (e.g. React Flow's) expect.
import { EdgeKind, NodeKind } from '../pipelines/model';
import { StoredEdge, StoredGraph } from './store';

export type DiagramNodeKind = NodeKind | 'group';

export interface DiagramExternalDependency {
	name: string;
	count: number;
}

export interface DiagramMetrics {
	fileCount: number;
	symbolCount: number;
	fanIn: number;
	fanOut: number;
	externalDependencies: DiagramExternalDependency[];
	testLinks: string[];
	changedFileCount: number;
}

export interface DiagramNode {
	id: string;
	kind: DiagramNodeKind;
	label: string;
	parentId?: string;
	filePath?: string;
	metrics?: DiagramMetrics;
}

export interface DiagramEdgeKindCount {
	kind: EdgeKind;
	count: number;
}

export interface DiagramEdge {
	id: string;
	source: string;
	target: string;
	kinds: DiagramEdgeKindCount[];
}

export interface DiagramModel {
	nodes: DiagramNode[];
	edges: DiagramEdge[];
}

/**
 * Absolute file paths "under" a `DiagramModel` node: a `file` node maps to
 * itself, a folder/module group (./moduleAggregation) maps to every file
 * nested inside it. `computeDiagramMetrics` (./diagramMetrics) only produces
 * metrics for a node with an entry here — there is nothing to measure for a
 * bare nesting node, e.g. an intermediate folder level between the root and
 * a module aggregation's configured depth.
 */
export type DiagramNodeFilePaths = ReadonlyMap<string, readonly string[]>;

export interface DiagramModelResult {
	model: DiagramModel;
	filePathsByNodeId: DiagramNodeFilePaths;
}

/**
 * Collapses `edges` onto one `DiagramEdge` per (resolved source, resolved
 * target) pair, breaking the count down per edge kind — e.g. two `calls` and
 * one `imports` edge between the same pair become a single `DiagramEdge`
 * with `kinds: [{kind:'calls',count:2},{kind:'imports',count:1}]`.
 * `resolveEndpoint` lets a caller remap an edge's raw node ids onto something
 * coarser (a folder/module group id, in ./moduleAggregation) or drop the edge
 * entirely by returning `undefined` (e.g. for an `externalModule` target,
 * which ./moduleAggregation tallies as a metric instead of a group-to-group
 * edge). A resolved self-edge is always dropped, matching `../ui/graphFilter`'s
 * rule for the same situation.
 */
export function aggregateEdgesByEndpoint(
	edges: readonly StoredEdge[],
	resolveEndpoint: (nodeId: string) => string | undefined
): DiagramEdge[] {
	const pairsByKey = new Map<string, { source: string; target: string; kinds: Map<EdgeKind, number> }>();

	for (const edge of edges) {
		const source = resolveEndpoint(edge.source);
		const target = resolveEndpoint(edge.target);
		if (!source || !target || source === target) {
			continue;
		}

		const key = `${source}::${target}`;
		const pair = pairsByKey.get(key) ?? { source, target, kinds: new Map<EdgeKind, number>() };
		pair.kinds.set(edge.kind, (pair.kinds.get(edge.kind) ?? 0) + 1);
		pairsByKey.set(key, pair);
	}

	return [...pairsByKey.values()].map((pair) => ({
		id: `diagram-edge:${pair.source}:${pair.target}`,
		source: pair.source,
		target: pair.target,
		kinds: [...pair.kinds.entries()].map(([kind, count]) => ({ kind, count }))
	}));
}

/**
 * The full-detail `DiagramModel` for `graph`: one `DiagramNode` per graph
 * node (including `externalModule` nodes), nested by `contains`, with every
 * other edge kind aggregated by `aggregateEdgesByEndpoint`. The basis for a
 * per-symbol view; ./moduleAggregation builds the coarser folder/module view
 * from the same `StoredGraph` instead of from this result.
 */
export function buildDiagramModel(graph: StoredGraph): DiagramModelResult {
	const parentIdByNodeId = new Map<string, string>();
	for (const edge of graph.edges) {
		if (edge.kind === 'contains') {
			parentIdByNodeId.set(edge.target, edge.source);
		}
	}

	const nodes: DiagramNode[] = graph.nodes.map((node) => ({
		id: node.id,
		kind: node.kind,
		label: node.name,
		parentId: parentIdByNodeId.get(node.id),
		filePath: node.filePath
	}));

	const edges = aggregateEdgesByEndpoint(
		graph.edges.filter((edge) => edge.kind !== 'contains'),
		(nodeId) => nodeId
	);

	const filePathsByNodeId = new Map<string, readonly string[]>();
	for (const node of graph.nodes) {
		if (node.kind === 'file' && node.filePath) {
			filePathsByNodeId.set(node.id, [node.filePath]);
		}
	}

	return { model: { nodes, edges }, filePathsByNodeId };
}
