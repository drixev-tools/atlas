// Root React component of the Project Graph webview (Fase 1.2, Epic F).
// Owns the graph state received over `postMessage` (./protocol) and derives,
// on every render, the currently visible subgraph (./graphExpansion) and its
// hierarchical layout (./graphLayout) — both pure, unit-tested modules
// shared with the extension host side where useful. Rendering itself is
// React Flow's job; this component only wires click -> expansion/selection
// state and passes the result down as plain node/edge props.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type NodeMouseHandler } from '@xyflow/react';
import { StoredGraph, StoredNode } from '../../core/store';
import { countEdges, visibleGraph } from '../graphExpansion';
import { computeHierarchicalLayout } from '../graphLayout';
import { HostToWebviewMessage } from './protocol';
import { postToHost } from './vscodeApi';
import { WorkflowNode, WorkflowFlowNode } from './WorkflowNode';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;

const NODE_TYPES = { workflowNode: WorkflowNode };

const EMPTY_GRAPH: StoredGraph = { nodes: [], edges: [] };

export function App(): ReactElement {
	const [graph, setGraph] = useState<StoredGraph | undefined>(undefined);
	const [focusNodeId, setFocusNodeId] = useState<string | undefined>(undefined);
	const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(new Set());
	const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<HostToWebviewMessage>): void => {
			const message = event.data;
			if (message.type === 'graph:update') {
				setGraph(message.graph);
				setFocusNodeId(message.focusNodeId);
				setExpandedNodeIds(new Set());
				setSelectedNodeId(message.focusNodeId);
			} else if (message.type === 'graph:select') {
				setFocusNodeId(message.nodeId);
				setExpandedNodeIds(new Set());
				setSelectedNodeId(message.nodeId);
			}
		};
		window.addEventListener('message', handleMessage);
		postToHost({ type: 'graph:ready' });
		return () => window.removeEventListener('message', handleMessage);
	}, []);

	const visible = useMemo<StoredGraph>(() => {
		if (!graph || !focusNodeId) {
			return EMPTY_GRAPH;
		}
		return visibleGraph(graph, focusNodeId, expandedNodeIds);
	}, [graph, focusNodeId, expandedNodeIds]);

	const positions = useMemo(
		() =>
			computeHierarchicalLayout(
				visible.nodes.map((node) => node.id),
				visible.edges.map((edge) => ({ source: edge.source, target: edge.target })),
				{ nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT }
			),
		[visible]
	);

	/** Task: node selection + progressive expansion — a single click both selects a node (drives the detail panel) and toggles whether its neighbors beyond the current focus are shown. */
	const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
		setSelectedNodeId(node.id);
		setExpandedNodeIds((previous) => {
			const next = new Set(previous);
			if (next.has(node.id)) {
				next.delete(node.id);
			} else {
				next.add(node.id);
			}
			return next;
		});
	}, []);

	const rfNodes: WorkflowFlowNode[] = useMemo(
		() =>
			visible.nodes.map((node) => {
				const position = positions.get(node.id) ?? { x: 0, y: 0 };
				const totalRelations = graph ? countEdges(graph, node.id) : { incoming: 0, outgoing: 0 };
				const visibleRelations = countEdges(visible, node.id);
				const hasHiddenRelations =
					totalRelations.incoming + totalRelations.outgoing > visibleRelations.incoming + visibleRelations.outgoing;
				return {
					id: node.id,
					type: 'workflowNode',
					position: { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 },
					data: {
						label: node.name,
						kind: node.kind as WorkflowFlowNode['data']['kind'],
						status: node.status,
						filePath: node.filePath,
						isFocused: node.id === focusNodeId,
						isSelected: node.id === selectedNodeId,
						isExpanded: expandedNodeIds.has(node.id),
						hasHiddenRelations
					}
				};
			}),
		[visible, positions, graph, focusNodeId, selectedNodeId, expandedNodeIds]
	);

	const rfEdges: Edge[] = useMemo(
		() =>
			visible.edges.map((edge) => ({
				id: edge.id,
				source: edge.source,
				target: edge.target,
				label: edge.kind === 'contains' ? undefined : edge.kind,
				className: `workflow-edge status-${edge.status}`,
				markerEnd: { type: MarkerType.ArrowClosed }
			})),
		[visible]
	);

	const selectedNode = graph && selectedNodeId ? graph.nodes.find((node) => node.id === selectedNodeId) : undefined;

	return (
		<div className="app-root">
			{!graph && <EmptyState message="Loading Project Graph…" />}
			{graph && visible.nodes.length === 0 && (
				<EmptyState message='No nodes to display yet. Run "Project Graph: Analyze Workspace" first.' />
			)}
			{graph && visible.nodes.length > 0 && (
				<ReactFlow
					key={focusNodeId}
					nodes={rfNodes}
					edges={rfEdges}
					nodeTypes={NODE_TYPES}
					onNodeClick={handleNodeClick}
					fitView
					proOptions={{ hideAttribution: true }}
				>
					<Background />
					<Controls />
				</ReactFlow>
			)}
			{selectedNode && graph && (
				<DetailPanel node={selectedNode} counts={countEdges(graph, selectedNode.id)} onClose={() => setSelectedNodeId(undefined)} />
			)}
			<Legend />
		</div>
	);
}

function EmptyState({ message }: { message: string }): ReactElement {
	return <div className="empty-state">{message}</div>;
}

interface DetailPanelProps {
	node: StoredNode;
	counts: { incoming: number; outgoing: number };
	onClose: () => void;
}

function DetailPanel({ node, counts, onClose }: DetailPanelProps): ReactElement {
	return (
		<div className="detail-panel">
			<div className="detail-header">
				<span className="detail-title">{node.name}</span>
				<button className="detail-close" aria-label="Close details" title="Close" onClick={onClose}>
					&times;
				</button>
			</div>
			<dl className="detail-fields">
				<dt>Kind</dt>
				<dd>{node.kind}</dd>
				<dt>Status</dt>
				<dd>{node.status}</dd>
				{node.filePath && (
					<>
						<dt>File</dt>
						<dd>{node.filePath}</dd>
					</>
				)}
				<dt>Relations</dt>
				<dd>
					{counts.incoming} incoming, {counts.outgoing} outgoing
				</dd>
			</dl>
		</div>
	);
}

function Legend(): ReactElement {
	return (
		<div className="status-legend">
			<span>
				<span className="swatch status-observed_only" />
				Observed
			</span>
			<span>
				<span className="swatch status-proposed_only" />
				Proposed only
			</span>
			<span>
				<span className="swatch status-matched" />
				Matched
			</span>
		</div>
	);
}
