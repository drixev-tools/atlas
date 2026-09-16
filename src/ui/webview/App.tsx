// Root React component of the Project Graph webview. Owns the graph state
// received over `postMessage` (./protocol) and derives, on every render, the
// currently visible level's data and layout — all pure, unit-tested modules
// shared with the extension host side where useful. Rendering itself is
// React Flow's job; this component only wires click -> navigation/selection
// state and passes the result down as plain node/edge props.
//
// "Open Architecture" opens on the layers level (the folder/module-aggregated
// `DiagramModel` the host sends as `architecture`, see ../architectureLayers):
// the system's organization at a glance. Drilling into a group shows its
// member files (the files level, fetched on demand via
// `architecture:requestFiles`); drilling into a file switches to the symbol
// level, which is exactly this view's original per-file focus+expand
// behavior (unchanged, both in code and by design — the deepest level of
// detail stays file-centered).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, type Edge, type NodeMouseHandler } from '@xyflow/react';
import { DiagramModel } from '../../core/diagramModel';
import { StoredGraph, StoredNode } from '../../core/store';
import { countEdges, visibleGraph } from '../graphExpansion';
import { computeDiagramLayout } from '../diagramLayout';
import { computeHierarchicalLayout } from '../graphLayout';
import { ArchitectureFilesPayload, ArchitectureLayerLabel, ArchitectureLayerPayload, ExportFormat, GraphExportView, HostToWebviewMessage } from './protocol';
import { postToHost } from './vscodeApi';
import { WorkflowNode, WorkflowFlowNode } from './WorkflowNode';
import { DiagramCardData, DiagramCardFlowNode, DiagramCardNode, DiagramGroupData, DiagramGroupFlowNode, DiagramGroupNode } from './DiagramCardNode';
import { dominantEdgeKind, DIAGRAM_EDGE_VISUALS } from './visualSystem';
import { ExportButton } from './ExportButton';
import { captureViewExport } from './exportCapture';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;

const WORKFLOW_NODE_TYPES = { workflowNode: WorkflowNode };
const DIAGRAM_NODE_TYPES = { diagramCard: DiagramCardNode, diagramGroup: DiagramGroupNode };

const EMPTY_GRAPH: StoredGraph = { nodes: [], edges: [] };
const EMPTY_ARCHITECTURE: ArchitectureLayerPayload = { model: { nodes: [], edges: [] }, labelsByGroupId: {}, entryPointGroupIds: [] };

type ViewMode = 'layers' | 'files' | 'symbols';

export function App(): ReactElement {
	const [graph, setGraph] = useState<StoredGraph | undefined>(undefined);
	const [architecture, setArchitecture] = useState<ArchitectureLayerPayload>(EMPTY_ARCHITECTURE);
	const [filesByGroupId, setFilesByGroupId] = useState<Map<string, ArchitectureFilesPayload>>(new Map());

	const [viewMode, setViewMode] = useState<ViewMode>('layers');
	const [activeGroup, setActiveGroup] = useState<{ id: string; label: string } | undefined>(undefined);
	const [selectedCardId, setSelectedCardId] = useState<string | undefined>(undefined);

	const [focusNodeId, setFocusNodeId] = useState<string | undefined>(undefined);
	const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(new Set());
	const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);

	const [isExporting, setIsExporting] = useState(false);
	const diagramContainerRef = useRef<HTMLDivElement>(null);

	const handleExportCapture = useCallback(async (format: ExportFormat) => {
		const element = diagramContainerRef.current;
		if (!element) {
			postToHost({ type: 'graph:exportCaptureFailed' });
			return;
		}
		setIsExporting(true);
		try {
			const captured = await captureViewExport(element, format);
			postToHost({ type: 'graph:exportCaptured', format, ...captured });
		} catch {
			postToHost({ type: 'graph:exportCaptureFailed' });
		} finally {
			setIsExporting(false);
		}
	}, []);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<HostToWebviewMessage>): void => {
			const message = event.data;
			if (message.type === 'graph:update') {
				setGraph(message.graph);
				setArchitecture(message.architecture);
				setFilesByGroupId(new Map());
				setViewMode('layers');
				setActiveGroup(undefined);
				setSelectedCardId(undefined);
				setFocusNodeId(message.focusNodeId);
				setExpandedNodeIds(new Set());
				setSelectedNodeId(undefined);
			} else if (message.type === 'graph:select') {
				setViewMode('symbols');
				setActiveGroup(undefined);
				setSelectedCardId(undefined);
				setFocusNodeId(message.nodeId);
				setExpandedNodeIds(new Set());
				setSelectedNodeId(message.nodeId);
			} else if (message.type === 'architecture:labels') {
				setArchitecture((previous) => ({
					...previous,
					labelsByGroupId: { ...previous.labelsByGroupId, ...message.labelsByGroupId }
				}));
			} else if (message.type === 'architecture:files') {
				setFilesByGroupId((previous) => new Map(previous).set(message.payload.groupId, message.payload));
			} else if (message.type === 'graph:exportCapture') {
				void handleExportCapture(message.format);
			}
		};
		window.addEventListener('message', handleMessage);
		postToHost({ type: 'graph:ready' });
		return () => window.removeEventListener('message', handleMessage);
	}, [handleExportCapture]);

	const openGroupFiles = useCallback(
		(groupId: string, label: string) => {
			setActiveGroup({ id: groupId, label });
			setViewMode('files');
			setSelectedCardId(undefined);
			if (!filesByGroupId.has(groupId)) {
				postToHost({ type: 'architecture:requestFiles', groupId });
			}
		},
		[filesByGroupId]
	);

	const openFileSymbols = useCallback((fileId: string) => {
		setViewMode('symbols');
		setFocusNodeId(fileId);
		setExpandedNodeIds(new Set());
		setSelectedNodeId(fileId);
	}, []);

	const handleLayerCardClick: NodeMouseHandler = useCallback(
		(_event, node) => {
			setSelectedCardId(node.id);
			const diagramNode = architecture.model.nodes.find((candidate) => candidate.id === node.id);
			if (diagramNode?.metrics) {
				const label = architecture.labelsByGroupId[node.id]?.label ?? diagramNode.label;
				openGroupFiles(node.id, label);
			}
		},
		[architecture, openGroupFiles]
	);

	const handleFileCardClick: NodeMouseHandler = useCallback(
		(_event, node) => {
			setSelectedCardId(node.id);
			openFileSymbols(node.id);
		},
		[openFileSymbols]
	);

	const handleSymbolNodeClick: NodeMouseHandler = useCallback((_event, node) => {
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

	const handleExportClick = useCallback(() => {
		const view: GraphExportView =
			viewMode === 'symbols'
				? { level: 'symbols', focusNodeId: focusNodeId ?? '', expandedNodeIds: [...expandedNodeIds] }
				: viewMode === 'files' && activeGroup
					? { level: 'files', groupId: activeGroup.id }
					: { level: 'layers' };
		postToHost({ type: 'graph:exportRequest', view });
	}, [viewMode, activeGroup, focusNodeId, expandedNodeIds]);

	const exportToolbar = <ExportButton onClick={handleExportClick} disabled={isExporting} />;

	if (viewMode === 'symbols') {
		return (
			<SymbolLevelView
				graph={graph}
				focusNodeId={focusNodeId}
				expandedNodeIds={expandedNodeIds}
				selectedNodeId={selectedNodeId}
				onNodeClick={handleSymbolNodeClick}
				onCloseDetail={() => setSelectedNodeId(undefined)}
				breadcrumb={<Breadcrumb activeGroup={activeGroup} viewMode={viewMode} symbolLabel={graph?.nodes.find((n) => n.id === focusNodeId)?.name} onNavigate={navigateBreadcrumb(setViewMode, setActiveGroup, setSelectedCardId)} />}
				exportToolbar={exportToolbar}
				containerRef={diagramContainerRef}
			/>
		);
	}

	if (viewMode === 'files' && activeGroup) {
		const filesPayload = filesByGroupId.get(activeGroup.id);
		return (
			<DiagramLevelView
				model={filesPayload?.model}
				entryPointIds={new Set(filesPayload?.entryPointFileIds ?? [])}
				labelsByGroupId={{}}
				loadingMessage={!filesPayload ? `Loading files in "${activeGroup.label}"...` : undefined}
				selectedId={selectedCardId}
				onNodeClick={handleFileCardClick}
				breadcrumb={<Breadcrumb activeGroup={activeGroup} viewMode={viewMode} onNavigate={navigateBreadcrumb(setViewMode, setActiveGroup, setSelectedCardId)} />}
				exportToolbar={exportToolbar}
				containerRef={diagramContainerRef}
			/>
		);
	}

	return (
		<DiagramLevelView
			model={architecture.model}
			entryPointIds={new Set(architecture.entryPointGroupIds)}
			labelsByGroupId={architecture.labelsByGroupId}
			loadingMessage={!graph ? 'Loading Project Graph…' : undefined}
			selectedId={selectedCardId}
			onNodeClick={handleLayerCardClick}
			breadcrumb={<Breadcrumb activeGroup={undefined} viewMode={viewMode} onNavigate={navigateBreadcrumb(setViewMode, setActiveGroup, setSelectedCardId)} />}
			exportToolbar={exportToolbar}
			containerRef={diagramContainerRef}
		/>
	);
}

function navigateBreadcrumb(
	setViewMode: (mode: ViewMode) => void,
	setActiveGroup: (group: { id: string; label: string } | undefined) => void,
	setSelectedCardId: (id: string | undefined) => void
): (target: 'layers' | 'files') => void {
	return (target) => {
		setSelectedCardId(undefined);
		if (target === 'layers') {
			setActiveGroup(undefined);
			setViewMode('layers');
		} else {
			setViewMode('files');
		}
	};
}

interface BreadcrumbProps {
	activeGroup: { id: string; label: string } | undefined;
	viewMode: ViewMode;
	symbolLabel?: string;
	onNavigate: (target: 'layers' | 'files') => void;
}

function Breadcrumb({ activeGroup, viewMode, symbolLabel, onNavigate }: BreadcrumbProps): ReactElement {
	const items: { key: string; label: string; current: boolean; onClick?: () => void }[] = [
		{ key: 'layers', label: 'Layers', current: viewMode === 'layers', onClick: viewMode === 'layers' ? undefined : () => onNavigate('layers') }
	];
	if (activeGroup) {
		items.push({
			key: 'files',
			label: activeGroup.label,
			current: viewMode === 'files',
			onClick: viewMode === 'files' ? undefined : () => onNavigate('files')
		});
	}
	if (viewMode === 'symbols' && symbolLabel) {
		items.push({ key: 'symbols', label: symbolLabel, current: true });
	}

	return (
		<div className="ag-breadcrumb">
			{items.map((item, index) => (
				<span key={item.key}>
					{index > 0 && <span className="ag-breadcrumb-sep"> / </span>}
					<button className="ag-breadcrumb-item" disabled={!item.onClick} onClick={item.onClick}>
						{item.label}
					</button>
				</span>
			))}
		</div>
	);
}

interface DiagramLevelViewProps {
	model: DiagramModel | undefined;
	entryPointIds: ReadonlySet<string>;
	labelsByGroupId: Record<string, ArchitectureLayerLabel>;
	loadingMessage: string | undefined;
	selectedId: string | undefined;
	onNodeClick: NodeMouseHandler;
	breadcrumb: ReactElement;
	exportToolbar: ReactElement;
	containerRef: RefObject<HTMLDivElement>;
}

function DiagramLevelView({ model, entryPointIds, labelsByGroupId, loadingMessage, selectedId, onNodeClick, breadcrumb, exportToolbar, containerRef }: DiagramLevelViewProps): ReactElement {
	const orderedNodes = useMemo(() => (model ? topologicallyOrderNodes(model) : []), [model]);

	const boxes = useMemo(
		() => computeDiagramLayout(orderedNodes.map((node) => ({ id: node.id, parentId: node.parentId })), model?.edges ?? []),
		[orderedNodes, model]
	);

	const siblingIndexById = useMemo(() => computeSiblingIndex(orderedNodes), [orderedNodes]);

	const hasChildrenById = useMemo(() => {
		const result = new Set<string>();
		for (const node of orderedNodes) {
			if (node.parentId) {
				result.add(node.parentId);
			}
		}
		return result;
	}, [orderedNodes]);

	const flowNodes: (DiagramCardFlowNode | DiagramGroupFlowNode)[] = useMemo(
		() =>
			orderedNodes.map((node) => {
				const box = boxes.get(node.id) ?? { x: 0, y: 0, width: 220, height: 92 };
				const isGroupContainer = node.kind === 'group' && hasChildrenById.has(node.id);
				const base = {
					id: node.id,
					position: { x: box.x, y: box.y },
					style: { width: box.width, height: box.height },
					parentId: node.parentId,
					extent: node.parentId ? ('parent' as const) : undefined
				};
				if (isGroupContainer) {
					const data: DiagramGroupData = {
						label: labelsByGroupId[node.id]?.label ?? node.label,
						purpose: labelsByGroupId[node.id]?.description,
						hasEntryPoint: entryPointIds.has(node.id),
						tintIndex: siblingIndexById.get(node.id) ?? 0
					};
					return { ...base, type: 'diagramGroup', data };
				}
				const data: DiagramCardData = {
					kind: node.kind as DiagramCardData['kind'],
					label: labelsByGroupId[node.id]?.label ?? node.label,
					purpose: labelsByGroupId[node.id]?.description,
					metrics: node.metrics,
					hasEntryPoint: entryPointIds.has(node.id),
					isSelected: node.id === selectedId
				};
				return { ...base, type: 'diagramCard', data };
			}),
		[orderedNodes, boxes, hasChildrenById, siblingIndexById, labelsByGroupId, entryPointIds, selectedId]
	);

	const flowEdges: Edge[] = useMemo(
		() =>
			(model?.edges ?? []).map((edge) => {
				const dominant = dominantEdgeKind(edge.kinds);
				const totalCount = edge.kinds.reduce((sum, entry) => sum + entry.count, 0);
				return {
					id: edge.id,
					source: edge.source,
					target: edge.target,
					type: 'default',
					className: DIAGRAM_EDGE_VISUALS[dominant].className,
					label: String(totalCount),
					labelBgStyle: { fill: 'var(--vscode-editorWidget-background)' },
					labelStyle: { fontSize: 10 },
					markerEnd: { type: MarkerType.ArrowClosed }
				};
			}),
		[model]
	);

	return (
		<div className="app-root">
			{breadcrumb}
			{exportToolbar}
			{loadingMessage && <EmptyState message={loadingMessage} />}
			{!loadingMessage && flowNodes.length === 0 && <EmptyState message='No nodes to display yet. Run "Project Graph: Analyze Workspace" first.' />}
			{!loadingMessage && flowNodes.length > 0 && (
				<div ref={containerRef} style={{ width: '100%', height: '100%' }}>
					<ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={DIAGRAM_NODE_TYPES} onNodeClick={onNodeClick} fitView proOptions={{ hideAttribution: true }}>
						<Background variant={BackgroundVariant.Dots} gap={20} size={1} />
						<Controls />
					</ReactFlow>
				</div>
			)}
		</div>
	);
}

function topologicallyOrderNodes(model: DiagramModel): DiagramModel['nodes'] {
	const byParentFirst = [...model.nodes].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
	const placed = new Set<string>();
	const ordered: DiagramModel['nodes'] = [];
	const remaining = [...byParentFirst];
	while (remaining.length > 0) {
		let progressed = false;
		for (let i = 0; i < remaining.length; i++) {
			const node = remaining[i];
			if (!node.parentId || placed.has(node.parentId)) {
				ordered.push(node);
				placed.add(node.id);
				remaining.splice(i, 1);
				progressed = true;
				break;
			}
		}
		if (!progressed) {
			ordered.push(...remaining);
			break;
		}
	}
	return ordered;
}

function computeSiblingIndex(nodes: DiagramModel['nodes']): Map<string, number> {
	const counters = new Map<string, number>();
	const result = new Map<string, number>();
	for (const node of nodes) {
		const key = node.parentId ?? '';
		const index = counters.get(key) ?? 0;
		result.set(node.id, index);
		counters.set(key, index + 1);
	}
	return result;
}

interface SymbolLevelViewProps {
	graph: StoredGraph | undefined;
	focusNodeId: string | undefined;
	expandedNodeIds: ReadonlySet<string>;
	selectedNodeId: string | undefined;
	onNodeClick: NodeMouseHandler;
	onCloseDetail: () => void;
	breadcrumb: ReactElement;
	exportToolbar: ReactElement;
	containerRef: RefObject<HTMLDivElement>;
}

function SymbolLevelView({ graph, focusNodeId, expandedNodeIds, selectedNodeId, onNodeClick, onCloseDetail, breadcrumb, exportToolbar, containerRef }: SymbolLevelViewProps): ReactElement {
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
			{breadcrumb}
			{exportToolbar}
			{!graph && <EmptyState message="Loading Project Graph…" />}
			{graph && visible.nodes.length === 0 && (
				<EmptyState message='No nodes to display yet. Run "Project Graph: Analyze Workspace" first.' />
			)}
			{graph && visible.nodes.length > 0 && (
				<div ref={containerRef} style={{ width: '100%', height: '100%' }}>
					<ReactFlow
						key={focusNodeId}
						nodes={rfNodes}
						edges={rfEdges}
						nodeTypes={WORKFLOW_NODE_TYPES}
						onNodeClick={onNodeClick}
						fitView
						proOptions={{ hideAttribution: true }}
					>
						<Background />
						<Controls />
					</ReactFlow>
				</div>
			)}
			{selectedNode && graph && (
				<DetailPanel node={selectedNode} counts={countEdges(graph, selectedNode.id)} onClose={onCloseDetail} />
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
