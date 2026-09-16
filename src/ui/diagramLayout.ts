// Left-to-right layout for a `DiagramModel` (../core/diagramModel), used by
// the architecture view's "layers" and "files" levels (./webview/App.tsx).
// Unlike ./graphLayout's flat dagre wrapper for the symbol-level workflow
// view, this understands `DiagramNode.parentId` nesting: a node with
// children is laid out as a box sized around them (stacked vertically, no
// dagre needed for that single relationship), and only top-level boxes
// (standalone nodes and whole nested groups) are handed to dagre for the
// actual left-to-right placement. A nested node's resulting position is
// relative to its own immediate parent — exactly what React Flow expects
// from a node using `parentId`/`extent: 'parent'` — regardless of how many
// nesting levels deep it is, since the recursion computes each box relative
// to the one directly containing it.
import dagre from 'dagre';

export interface DiagramLayoutNode {
	id: string;
	parentId?: string;
}

export interface DiagramLayoutEdge {
	source: string;
	target: string;
}

export interface DiagramLayoutOptions {
	cardWidth?: number;
	cardHeight?: number;
	groupPadding?: number;
	groupHeaderHeight?: number;
	childGap?: number;
	nodeSeparation?: number;
	rankSeparation?: number;
}

export interface DiagramNodeBox {
	/** Absolute for a top-level node; relative to `DiagramLayoutNode.parentId` for a nested one. */
	x: number;
	y: number;
	width: number;
	height: number;
}

const DEFAULT_OPTIONS: Required<DiagramLayoutOptions> = {
	cardWidth: 220,
	cardHeight: 92,
	groupPadding: 16,
	groupHeaderHeight: 32,
	childGap: 12,
	nodeSeparation: 48,
	rankSeparation: 120
};

export function computeDiagramLayout(
	nodes: readonly DiagramLayoutNode[],
	edges: readonly DiagramLayoutEdge[],
	options: DiagramLayoutOptions = {}
): Map<string, DiagramNodeBox> {
	const config = { ...DEFAULT_OPTIONS, ...options };
	const knownIds = new Set(nodes.map((node) => node.id));

	const parentById = new Map<string, string>();
	const childrenByParent = new Map<string, string[]>();
	for (const node of nodes) {
		if (node.parentId && knownIds.has(node.parentId)) {
			parentById.set(node.id, node.parentId);
			const siblings = childrenByParent.get(node.parentId);
			if (siblings) {
				siblings.push(node.id);
			} else {
				childrenByParent.set(node.parentId, [node.id]);
			}
		}
	}

	const relativePositions = new Map<string, { x: number; y: number }>();
	const sizeByNodeId = new Map<string, { width: number; height: number }>();

	function layoutBox(nodeId: string): { width: number; height: number } {
		const children = childrenByParent.get(nodeId) ?? [];
		if (children.length === 0) {
			const size = { width: config.cardWidth, height: config.cardHeight };
			sizeByNodeId.set(nodeId, size);
			return size;
		}

		let maxChildWidth = 0;
		let y = config.groupHeaderHeight + config.groupPadding;
		for (const childId of children) {
			const childSize = layoutBox(childId);
			relativePositions.set(childId, { x: config.groupPadding, y });
			maxChildWidth = Math.max(maxChildWidth, childSize.width);
			y += childSize.height + config.childGap;
		}

		const size = { width: maxChildWidth + config.groupPadding * 2, height: y - config.childGap + config.groupPadding };
		sizeByNodeId.set(nodeId, size);
		return size;
	}

	const topLevelIds = nodes.filter((node) => !parentById.has(node.id)).map((node) => node.id);
	topLevelIds.forEach(layoutBox);

	function topAncestor(nodeId: string): string {
		let current = nodeId;
		for (let parent = parentById.get(current); parent; parent = parentById.get(current)) {
			current = parent;
		}
		return current;
	}

	const graph = new dagre.graphlib.Graph();
	graph.setGraph({ rankdir: 'LR', nodesep: config.nodeSeparation, ranksep: config.rankSeparation });
	graph.setDefaultEdgeLabel(() => ({}));

	for (const id of topLevelIds) {
		const size = sizeByNodeId.get(id) ?? { width: config.cardWidth, height: config.cardHeight };
		graph.setNode(id, size);
	}

	const seenPairs = new Set<string>();
	for (const edge of edges) {
		const source = topAncestor(edge.source);
		const target = topAncestor(edge.target);
		if (source === target || !knownIds.has(source) || !knownIds.has(target)) {
			continue;
		}
		const key = `${source}->${target}`;
		if (seenPairs.has(key)) {
			continue;
		}
		seenPairs.add(key);
		graph.setEdge(source, target);
	}

	dagre.layout(graph);

	const boxes = new Map<string, DiagramNodeBox>();
	for (const id of topLevelIds) {
		const size = sizeByNodeId.get(id) ?? { width: config.cardWidth, height: config.cardHeight };
		const laidOut = graph.node(id);
		boxes.set(id, { x: (laidOut?.x ?? 0) - size.width / 2, y: (laidOut?.y ?? 0) - size.height / 2, ...size });
	}
	for (const node of nodes) {
		if (boxes.has(node.id)) {
			continue;
		}
		const size = sizeByNodeId.get(node.id) ?? { width: config.cardWidth, height: config.cardHeight };
		const relative = relativePositions.get(node.id) ?? { x: 0, y: 0 };
		boxes.set(node.id, { x: relative.x, y: relative.y, ...size });
	}

	return boxes;
}
