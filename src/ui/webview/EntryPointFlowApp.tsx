// Root React component of the entry-point flow webview (Fase 1.3, Epic O):
// "what happens when X runs", rendered left-to-right from the entry point
// ../../core/entryPointFlow already resolved into a depth-bounded,
// cycle-safe `calls` chain. Only the entry point and its direct callees are
// shown by default; clicking a card with a collapsed-children hint reveals
// its own callees (../entryPointFlowExpansion), the same progressive-reveal
// idea ./App.tsx's symbol level uses. Layout reuses ../graphLayout's
// existing dagre wrapper in its `LR` direction rather than a new algorithm —
// branches and convergences fall out of laying out a DAG, nothing
// flow-specific to add there.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type NodeMouseHandler } from '@xyflow/react';
import { EntryPoint } from '../../core/entryPoints';
import { EntryPointFlow } from '../../core/entryPointFlow';
import { StoredNode } from '../../core/store';
import { childIds, hasCollapsedChildren, visibleEntryPointFlow } from '../entryPointFlowExpansion';
import { computeHierarchicalLayout } from '../graphLayout';
import { EntryPointFlowExportFormat, EntryPointFlowHostToWebviewMessage, EntryPointFlowPayload } from './entryPointFlowProtocol';
import { FlowCardData, FlowCardFlowNode, FlowCardNode } from './FlowCardNode';
import { postToHost } from './vscodeApi';
import { ExportButton } from './ExportButton';
import { captureViewExport } from './exportCapture';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 76;

const FLOW_NODE_TYPES = { flowCard: FlowCardNode };

function toEntryPointFlow(payload: EntryPointFlowPayload): EntryPointFlow {
	return {
		entryPointId: payload.entryPointId,
		nodes: payload.nodes,
		edges: payload.edges,
		depthById: new Map(Object.entries(payload.depthById)),
		truncatedNodeIds: new Set(payload.truncatedNodeIds)
	};
}

export function EntryPointFlowApp(): ReactElement {
	const [entryPoints, setEntryPoints] = useState<EntryPoint[]>([]);
	const [flow, setFlow] = useState<EntryPointFlow | undefined>(undefined);
	const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(new Set());
	const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);

	const [isExporting, setIsExporting] = useState(false);
	const diagramContainerRef = useRef<HTMLDivElement>(null);

	const handleExportCapture = useCallback(async (format: EntryPointFlowExportFormat) => {
		const element = diagramContainerRef.current;
		if (!element) {
			postToHost({ type: 'entryPointFlow:exportCaptureFailed' });
			return;
		}
		setIsExporting(true);
		try {
			const captured = await captureViewExport(element, format);
			postToHost({ type: 'entryPointFlow:exportCaptured', format, ...captured });
		} catch {
			postToHost({ type: 'entryPointFlow:exportCaptureFailed' });
		} finally {
			setIsExporting(false);
		}
	}, []);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<EntryPointFlowHostToWebviewMessage>): void => {
			const message = event.data;
			if (message.type === 'entryPointFlow:update') {
				setEntryPoints(message.entryPoints);
				setFlow(toEntryPointFlow(message.flow));
				setExpandedNodeIds(new Set());
				setSelectedNodeId(undefined);
			} else if (message.type === 'entryPointFlow:empty') {
				setEntryPoints(message.entryPoints);
				setFlow(undefined);
				setExpandedNodeIds(new Set());
				setSelectedNodeId(undefined);
			} else if (message.type === 'entryPointFlow:exportCapture') {
				void handleExportCapture(message.format);
			}
		};
		window.addEventListener('message', handleMessage);
		postToHost({ type: 'entryPointFlow:ready' });
		return () => window.removeEventListener('message', handleMessage);
	}, [handleExportCapture]);

	const handleExportClick = useCallback(() => {
		postToHost({ type: 'entryPointFlow:exportRequest', expandedNodeIds: [...expandedNodeIds] });
	}, [expandedNodeIds]);

	const handleSelectEntryPoint = useCallback((nodeId: string) => {
		postToHost({ type: 'entryPointFlow:selectEntryPoint', nodeId });
	}, []);

	const handleOpenNode = useCallback((nodeId: string) => {
		postToHost({ type: 'entryPointFlow:openNode', nodeId });
	}, []);

	const handleNodeClick: NodeMouseHandler = useCallback(
		(_event, node) => {
			setSelectedNodeId(node.id);
			if (!flow || childIds(flow, node.id).length === 0) {
				return;
			}
			setExpandedNodeIds((previous) => {
				const next = new Set(previous);
				if (next.has(node.id)) {
					next.delete(node.id);
				} else {
					next.add(node.id);
				}
				return next;
			});
		},
		[flow]
	);

	const visible = useMemo(() => (flow ? visibleEntryPointFlow(flow, expandedNodeIds) : undefined), [flow, expandedNodeIds]);

	const nodesById = useMemo(() => new Map((flow?.nodes ?? []).map((node) => [node.id, node] as const)), [flow]);

	const visibleNodes = useMemo(
		() => (visible ? [...visible.nodeIds].map((id) => nodesById.get(id)).filter((node): node is StoredNode => node !== undefined) : []),
		[visible, nodesById]
	);
	const visibleEdges = useMemo(() => (flow ? flow.edges.filter((edge) => visible?.edgeIds.has(edge.id)) : []), [flow, visible]);

	const positions = useMemo(
		() =>
			computeHierarchicalLayout(
				visibleNodes.map((node) => node.id),
				visibleEdges.map((edge) => ({ source: edge.source, target: edge.target })),
				{ direction: 'LR', nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT }
			),
		[visibleNodes, visibleEdges]
	);

	const flowNodes: FlowCardFlowNode[] = useMemo(
		() =>
			visibleNodes.map((node) => {
				const position = positions.get(node.id) ?? { x: 0, y: 0 };
				const data: FlowCardData = {
					kind: node.kind,
					label: node.name,
					filePath: node.filePath,
					isEntryPoint: node.id === flow?.entryPointId,
					isSelected: node.id === selectedNodeId,
					hasCollapsedChildren: flow ? hasCollapsedChildren(flow, node.id, visible?.nodeIds ?? new Set()) : false,
					isExpanded: expandedNodeIds.has(node.id),
					onOpen: handleOpenNode
				};
				return {
					id: node.id,
					type: 'flowCard',
					position: { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 },
					style: { width: NODE_WIDTH, height: NODE_HEIGHT },
					data
				};
			}),
		[visibleNodes, positions, flow, visible, selectedNodeId, expandedNodeIds, handleOpenNode]
	);

	const flowEdges: Edge[] = useMemo(
		() =>
			visibleEdges.map((edge) => ({
				id: edge.id,
				source: edge.source,
				target: edge.target,
				markerEnd: { type: MarkerType.ArrowClosed },
				className: 'ag-flow-edge'
			})),
		[visibleEdges]
	);

	return (
		<div className="app-root">
			<EntryPointToolbar entryPoints={entryPoints} selectedEntryPointId={flow?.entryPointId} onSelect={handleSelectEntryPoint} />
			<ExportButton onClick={handleExportClick} disabled={isExporting} />
			{!flow && <EmptyState message={entryPoints.length === 0 ? 'No entry points detected yet. Run "Analyze Workspace" first.' : 'Select an entry point to trace its call flow.'} />}
			{flow && flowNodes.length > 0 && (
				<div ref={diagramContainerRef} style={{ width: '100%', height: '100%' }}>
					<ReactFlow
						key={flow.entryPointId}
						nodes={flowNodes}
						edges={flowEdges}
						nodeTypes={FLOW_NODE_TYPES}
						onNodeClick={handleNodeClick}
						fitView
						proOptions={{ hideAttribution: true }}
					>
						<Background />
						<Controls />
					</ReactFlow>
				</div>
			)}
		</div>
	);
}

interface EntryPointToolbarProps {
	entryPoints: EntryPoint[];
	selectedEntryPointId: string | undefined;
	onSelect: (nodeId: string) => void;
}

function EntryPointToolbar({ entryPoints, selectedEntryPointId, onSelect }: EntryPointToolbarProps): ReactElement {
	return (
		<div className="ag-breadcrumb ag-flow-toolbar">
			<label htmlFor="ag-entry-point-select">Entry point</label>
			<select
				id="ag-entry-point-select"
				value={selectedEntryPointId ?? ''}
				disabled={entryPoints.length === 0}
				onChange={(event) => onSelect(event.target.value)}
			>
				{entryPoints.length === 0 && <option value="">None detected</option>}
				{entryPoints.map((entryPoint) => (
					<option key={entryPoint.nodeId} value={entryPoint.nodeId}>
						{entryPoint.name} ({entryPoint.kind})
					</option>
				))}
			</select>
		</div>
	);
}

function EmptyState({ message }: { message: string }): ReactElement {
	return <div className="empty-state">{message}</div>;
}
