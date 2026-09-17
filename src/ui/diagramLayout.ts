// Left-to-right layout for a `DiagramModel` (../core/diagramModel), used by
// the architecture view's "layers" and "files" levels (./webview/App.tsx).
// Unlike ./graphLayout's flat dagre wrapper for the symbol-level workflow
// view, this understands `DiagramNode.parentId` nesting: every group of
// siblings — the top-level nodes, and each group's own children — gets its
// own left-to-right dagre pass (`layoutSiblings`), with edges between two
// siblings resolved to their nearest common containing group first
// (`ancestorAtLevel`), so files merged into an expanded folder
// (./webview/App.tsx's `mergedArchitectureModel`) flow by their real import
// edges instead of just stacking in folder order. A group's own box is then
// sized to fit its children's dagre bounding box. A nested node's resulting
// position is relative to its own immediate parent — exactly what React Flow
// expects from a node using `parentId`/`extent: 'parent'` — regardless of
// how many nesting levels deep it is, since the recursion computes each box
// relative to the one directly containing it.
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

	/** The immediate child of `groupId` (or, when `groupId` is undefined, the top-level ancestor) that is `nodeId` itself or contains it — how a leaf-to-leaf edge resolves to an edge between two siblings at a given nesting level. Undefined if `nodeId` isn't inside `groupId` at all. */
	function ancestorAtLevel(nodeId: string, groupId: string | undefined): string | undefined {
		if (!knownIds.has(nodeId)) {
			return undefined;
		}
		let current = nodeId;
		while (true) {
			const parent = parentById.get(current);
			if (parent === groupId) {
				return current;
			}
			if (parent === undefined) {
				return undefined;
			}
			current = parent;
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

		children.forEach(layoutBox);
		const { positions, width, height } = layoutSiblings(children, sizeByNodeId, edges, (id) => ancestorAtLevel(id, nodeId), config);
		for (const childId of children) {
			const position = positions.get(childId) ?? { x: 0, y: 0 };
			relativePositions.set(childId, { x: position.x + config.groupPadding, y: position.y + config.groupHeaderHeight + config.groupPadding });
		}

		const size = { width: width + config.groupPadding * 2, height: height + config.groupHeaderHeight + config.groupPadding * 2 };
		sizeByNodeId.set(nodeId, size);
		return size;
	}

	const topLevelIds = nodes.filter((node) => !parentById.has(node.id)).map((node) => node.id);
	topLevelIds.forEach(layoutBox);
	const topPositions = layoutSiblings(topLevelIds, sizeByNodeId, edges, (id) => ancestorAtLevel(id, undefined), config).positions;

	const boxes = new Map<string, DiagramNodeBox>();
	for (const id of topLevelIds) {
		const size = sizeByNodeId.get(id) ?? { width: config.cardWidth, height: config.cardHeight };
		const position = topPositions.get(id) ?? { x: 0, y: 0 };
		boxes.set(id, { x: position.x, y: position.y, ...size });
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

/**
 * Left-to-right dagre layout of one set of siblings, with `resolve` mapping
 * an edge's raw endpoint down to whichever of `siblingIds` it belongs under
 * (or `undefined` if it's outside this group entirely). Positions come back
 * normalized so the tightest bounding box starts at `(0, 0)` — the caller
 * offsets that into its own coordinate space (absolute for the top level,
 * padded/relative for a group's children).
 */
function layoutSiblings(
	siblingIds: readonly string[],
	sizeById: ReadonlyMap<string, { width: number; height: number }>,
	edges: readonly DiagramLayoutEdge[],
	resolve: (id: string) => string | undefined,
	config: Required<DiagramLayoutOptions>
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
	if (siblingIds.length === 0) {
		return { positions: new Map(), width: 0, height: 0 };
	}

	const graph = new dagre.graphlib.Graph();
	graph.setGraph({ rankdir: 'LR', nodesep: config.nodeSeparation, ranksep: config.rankSeparation });
	graph.setDefaultEdgeLabel(() => ({}));

	for (const id of siblingIds) {
		// Cloned: dagre mutates whatever object it's given (adding `x`/`y`, and briefly swapping
		// `width`/`height` for an 'LR' pass), and `sizeById`'s entries are reused across every
		// level's own layoutSiblings call as well as read back afterward — sharing the object would
		// leak one call's positions/mutations into the next.
		graph.setNode(id, { ...(sizeById.get(id) ?? { width: config.cardWidth, height: config.cardHeight }) });
	}

	const seenPairs = new Set<string>();
	for (const edge of edges) {
		const source = resolve(edge.source);
		const target = resolve(edge.target);
		if (!source || !target || source === target) {
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
	for (const id of siblingIds) {
		const size = sizeById.get(id) ?? { width: config.cardWidth, height: config.cardHeight };
		const laidOut = graph.node(id);
		boxes.set(id, { x: (laidOut?.x ?? 0) - size.width / 2, y: (laidOut?.y ?? 0) - size.height / 2, ...size });
	}
	resolveVerticalOverlaps(boxes, siblingIds, config.nodeSeparation);

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const id of siblingIds) {
		const box = boxes.get(id) as DiagramNodeBox;
		minX = Math.min(minX, box.x);
		minY = Math.min(minY, box.y);
		maxX = Math.max(maxX, box.x + box.width);
		maxY = Math.max(maxY, box.y + box.height);
	}

	const positions = new Map<string, { x: number; y: number }>();
	for (const id of siblingIds) {
		const box = boxes.get(id) as DiagramNodeBox;
		positions.set(id, { x: box.x - minX, y: box.y - minY });
	}

	return { positions, width: maxX - minX, height: maxY - minY };
}

/**
 * dagre's `nodesep` only reliably separates nodes it can place in a strict
 * rank order; a cycle among the collapsed sibling edges (common for
 * mutually-importing files/folders) or a node with no edges at all can still
 * come out of `dagre.layout` overlapping another sibling's full box
 * (including its own nested children, not just its own card). Sweeps `ids`
 * pairwise and pushes the lower box down until none overlap, since dagre's
 * `x` already encodes a meaningful left-to-right dependency order that a
 * fix-up pass shouldn't disturb.
 */
function resolveVerticalOverlaps(boxes: Map<string, DiagramNodeBox>, ids: readonly string[], gap: number): void {
	for (let iteration = 0; iteration < ids.length + 1; iteration++) {
		let moved = false;
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const a = boxes.get(ids[i]);
				const b = boxes.get(ids[j]);
				if (!a || !b || !boxesOverlap(a, b)) {
					continue;
				}
				const [top, bottom] = a.y <= b.y ? [a, b] : [b, a];
				const requiredY = top.y + top.height + gap;
				if (bottom.y < requiredY) {
					bottom.y = requiredY;
					moved = true;
				}
			}
		}
		if (!moved) {
			break;
		}
	}
}

function boxesOverlap(a: DiagramNodeBox, b: DiagramNodeBox): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
