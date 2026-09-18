// Lets a diagram's auto-computed layout (../diagramLayout, ../graphLayout)
// coexist with the user dragging cards around. `computedNodes` is recomputed
// from scratch (dagre isn't incremental) on every relevant change — expanding
// a folder, more architecture data streaming in, a selection change — so
// most nodes shift position on every recompute, not just newly added ones.
// Only a node id the user has actually dragged (`onNodesChange` sees a
// `position` change with `dragging: true`) keeps its manual position instead
// of the freshly computed one; every other node always takes the latest
// layout, which is what keeps the diagram overlap-free as data loads in.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Node, NodeChange, OnNodesChange } from '@xyflow/react';

export interface DraggableLayout<NodeType extends Node> {
	nodes: NodeType[];
	onNodesChange: OnNodesChange<NodeType>;
	resetLayout: () => void;
}

export function useDraggableLayout<NodeType extends Node>(computedNodes: NodeType[]): DraggableLayout<NodeType> {
	const draggedPositionsRef = useRef(new Map<string, { x: number; y: number }>());
	const [generation, setGeneration] = useState(0);

	const nodes = useMemo(() => {
		if (draggedPositionsRef.current.size === 0) {
			return computedNodes;
		}
		return computedNodes.map((node) => {
			const dragged = draggedPositionsRef.current.get(node.id);
			return dragged ? { ...node, position: dragged } : node;
		});
	}, [computedNodes, generation]);

	const onNodesChange: OnNodesChange<NodeType> = useCallback((changes: NodeChange<NodeType>[]) => {
		let moved = false;
		for (const change of changes) {
			if (change.type === 'position' && change.position && change.dragging) {
				draggedPositionsRef.current.set(change.id, change.position);
				moved = true;
			}
		}
		if (moved) {
			setGeneration((current) => current + 1);
		}
	}, []);

	const resetLayout = useCallback(() => {
		draggedPositionsRef.current.clear();
		setGeneration((current) => current + 1);
	}, []);

	return { nodes, onNodesChange, resetLayout };
}
