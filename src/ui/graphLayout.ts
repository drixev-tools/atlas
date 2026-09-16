// Hierarchical layout for whatever subset of the workflow-relevant graph is
// currently visible in the React Flow webview: positions nodes top-to-bottom
// by dagre's rank. A pure function over plain node/edge ids — no
// `dagre.graphlib.Graph`, `StoredGraph`, or React Flow type leaks past its
// return value — so it can be unit tested directly and reused for any
// node/edge shape.
import dagre from 'dagre';

export interface LayoutPosition {
	x: number;
	y: number;
}

export interface LayoutEdge {
	source: string;
	target: string;
}

export interface LayoutOptions {
	nodeWidth?: number;
	nodeHeight?: number;
	direction?: 'TB' | 'LR';
	nodeSeparation?: number;
	rankSeparation?: number;
}

const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 56;
const DEFAULT_NODE_SEPARATION = 48;
const DEFAULT_RANK_SEPARATION = 96;

/**
 * Lays out `nodeIds` (and `edges` between them) top-to-bottom by default,
 * dagre's most common "hierarchy" orientation. Node positions are dagre's
 * center coordinates; React Flow expects a node's top-left corner, so
 * callers subtract half of `nodeWidth`/`nodeHeight` themselves — kept a
 * caller concern rather than baked in here, since the caller is the one that
 * knows each node's actual rendered size.
 */
export function computeHierarchicalLayout(
	nodeIds: readonly string[],
	edges: readonly LayoutEdge[],
	options: LayoutOptions = {}
): Map<string, LayoutPosition> {
	const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
	const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;

	const graph = new dagre.graphlib.Graph();
	graph.setGraph({
		rankdir: options.direction ?? 'TB',
		nodesep: options.nodeSeparation ?? DEFAULT_NODE_SEPARATION,
		ranksep: options.rankSeparation ?? DEFAULT_RANK_SEPARATION
	});
	graph.setDefaultEdgeLabel(() => ({}));

	const knownNodeIds = new Set(nodeIds);
	for (const id of nodeIds) {
		graph.setNode(id, { width: nodeWidth, height: nodeHeight });
	}
	for (const edge of edges) {
		if (edge.source === edge.target) {
			continue;
		}
		if (knownNodeIds.has(edge.source) && knownNodeIds.has(edge.target)) {
			graph.setEdge(edge.source, edge.target);
		}
	}

	dagre.layout(graph);

	const positions = new Map<string, LayoutPosition>();
	for (const id of nodeIds) {
		const laidOut = graph.node(id);
		positions.set(id, laidOut ? { x: laidOut.x, y: laidOut.y } : { x: 0, y: 0 });
	}
	return positions;
}
