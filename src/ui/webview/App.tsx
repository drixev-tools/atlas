// Root React component of the Project Graph webview. Owns the graph state
// received over `postMessage` (./protocol) and derives, on every render, the
// currently visible level's data and layout — all pure, unit-tested modules
// shared with the extension host side where useful. Rendering itself is
// React Flow's job; this component only wires click -> navigation/selection
// state and passes the result down as plain node/edge props.
//
// "Open Architecture" opens on the layers level: the folder/module-aggregated
// `DiagramModel` the host sends as `architecture` (see ../architectureLayers)
// — every top-level folder group and every root-level loose file, all
// visible and connected by default, the same way a file explorer's top level
// is. Every folder's own member files are fetched and expanded by default
// too (`architecture:requestFiles`, one request per group on `graph:update`)
// and merged onto the SAME canvas as that folder's children
// (`mergedArchitectureModel` below) rather than navigating to a separate
// screen — clicking a card/box that owns files (per its `metrics`) still
// toggles it collapsed/expanded from there. Clicking a
// file card (root-level, or revealed by expanding its folder) asks the host
// (`architecture:openFileFlow`) to open that file's import flow in the Active
// File Flow view instead (a separate panel, see ../activeFileFlow and
// ../activeFileFlowPanel), since that already shows file-to-file relationships
// better than a containment diagram would.
//
// The symbol level itself still exists (`graph:select`, driven by the
// sidebar's "jump to symbol" — see ../sidebarView) — only the architecture
// view's own file-card click no longer reaches it.
//
// "Files" is a peer top-level mode (toggled via the breadcrumb, not nested
// under "Layers"): every file in the whole project as its own node, no
// folder grouping and nothing hidden behind a click — the flat counterpart
// to "Layers"'s folder-collapsed default, fetched once on first switch
// (`architecture:requestFlatFiles`) since it's a whole-project computation.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, type Edge, type NodeMouseHandler } from '@xyflow/react';
import { DiagramModel } from '../../core/diagramModel';
import { StoredGraph, StoredNode } from '../../core/store';
import { countEdges, visibleGraph } from '../graphExpansion';
import { hasHiddenStandaloneImports, visibleDiagramModel } from '../diagramFileExpansion';
import { computeDiagramLayout } from '../diagramLayout';
import { computeHierarchicalLayout } from '../graphLayout';
import {
	ArchitectureFilesPayload,
	ArchitectureFlatFilesPayload,
	ArchitectureLayerLabel,
	ArchitectureLayerPayload,
	ExportFormat,
	GraphExportView,
	HostToWebviewMessage
} from './protocol';
import { postToHost } from './vscodeApi';
import { WorkflowNode, WorkflowFlowNode } from './WorkflowNode';
import { DiagramCardData, DiagramCardFlowNode, DiagramCardNode, DiagramGroupData, DiagramGroupFlowNode, DiagramGroupNode } from './DiagramCardNode';
import { connectedNodeIds, dominantEdgeKind, DIAGRAM_EDGE_VISUALS, estimateDiagramCardHeight } from './visualSystem';
import { ExportButton } from './ExportButton';
import { DiagramToolbar } from './DiagramToolbar';
import { captureViewExport } from './exportCapture';
import { useDraggableLayout } from './useDraggableLayout';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;

const WORKFLOW_NODE_TYPES = { workflowNode: WorkflowNode };
const DIAGRAM_NODE_TYPES = { diagramCard: DiagramCardNode, diagramGroup: DiagramGroupNode };

const EMPTY_GRAPH: StoredGraph = { nodes: [], edges: [] };
const EMPTY_ARCHITECTURE: ArchitectureLayerPayload = { model: { nodes: [], edges: [] }, labelsByGroupId: {}, entryPointGroupIds: [] };
const EMPTY_DIAGRAM_MODEL: DiagramModel = { nodes: [], edges: [] };
const EMPTY_LABELS: Record<string, ArchitectureLayerLabel> = {};
const EMPTY_ARCH_NODE_IDS: ReadonlySet<string> = new Set();

type ViewMode = 'layers' | 'files' | 'symbols';

export function App(): ReactElement {
	const [graph, setGraph] = useState<StoredGraph | undefined>(undefined);
	const [architecture, setArchitecture] = useState<ArchitectureLayerPayload>(EMPTY_ARCHITECTURE);
	const [filesByGroupId, setFilesByGroupId] = useState<Map<string, ArchitectureFilesPayload>>(new Map());
	/** The whole-project "Files" mode's flat model, fetched once on first switch to that mode (`handleSelectFiles`) and reset to `undefined` on every fresh `graph:update`. */
	const [flatFiles, setFlatFiles] = useState<ArchitectureFlatFilesPayload | undefined>(undefined);

	const [viewMode, setViewMode] = useState<ViewMode>('layers');
	const [selectedCardId, setSelectedCardId] = useState<string | undefined>(undefined);
	/**
	 * Ids of expanded architecture-layers nodes: a folder group (its member
	 * files, fetched into `filesByGroupId`, get merged onto the canvas as its
	 * children) or a merged-in file (its own standalone import targets, see
	 * ../diagramFileExpansion, become visible). One flat set since ids never
	 * collide between the two.
	 */
	const [expandedArchNodeIds, setExpandedArchNodeIds] = useState<ReadonlySet<string>>(new Set());

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
				setFlatFiles(undefined);
				setViewMode('layers');
				setSelectedCardId(undefined);
				const expandableGroupIds = message.architecture.model.nodes.filter((node) => node.kind === 'group' && node.metrics).map((node) => node.id);
				setExpandedArchNodeIds(new Set(expandableGroupIds));
				for (const groupId of expandableGroupIds) {
					postToHost({ type: 'architecture:requestFiles', groupId });
				}
				setFocusNodeId(message.focusNodeId);
				setExpandedNodeIds(new Set());
				setSelectedNodeId(undefined);
			} else if (message.type === 'architecture:flatFiles') {
				setFlatFiles(message.payload);
			} else if (message.type === 'graph:select') {
				setViewMode('symbols');
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

	/**
	 * `architecture.model` with every expanded folder's own member files
	 * merged in as its children (`parentId` set to that folder's id) — the
	 * single canvas `DiagramLevelView` renders, in place of the old separate
	 * "files" screen. An id in `expandedArchNodeIds` with no `filesByGroupId`
	 * entry (a merged-in file expanded for its own standalone imports, not a
	 * folder) contributes nothing here, which is fine — there's no group
	 * payload to merge for it.
	 */
	const mergedArchitectureModel: DiagramModel = useMemo(() => {
		let nodes = architecture.model.nodes;
		let edges = architecture.model.edges;
		for (const id of expandedArchNodeIds) {
			const payload = filesByGroupId.get(id);
			if (!payload) {
				continue;
			}
			nodes = [...nodes, ...payload.model.nodes.map((node) => ({ ...node, parentId: id }))];
			edges = [...edges, ...payload.model.edges];
		}
		return { nodes, edges };
	}, [architecture, filesByGroupId, expandedArchNodeIds]);

	const mergedEntryPointIds = useMemo(() => {
		const ids = new Set(architecture.entryPointGroupIds);
		for (const id of expandedArchNodeIds) {
			for (const fileId of filesByGroupId.get(id)?.entryPointFileIds ?? []) {
				ids.add(fileId);
			}
		}
		return ids;
	}, [architecture, filesByGroupId, expandedArchNodeIds]);

	const flatFileEntryPointIds = useMemo(() => new Set(flatFiles?.entryPointFileIds ?? []), [flatFiles]);

	const toggleExpanded = useCallback((id: string) => {
		setExpandedArchNodeIds((previous) => {
			const next = new Set(previous);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	const handleArchNodeClick: NodeMouseHandler = useCallback(
		(_event, node) => {
			setSelectedCardId(node.id);
			const diagramNode = mergedArchitectureModel.nodes.find((candidate) => candidate.id === node.id);
			if (!diagramNode) {
				return;
			}

			if (diagramNode.kind === 'group') {
				if (!diagramNode.metrics) {
					return; // a pure nesting group — its subgroups are already always visible, nothing else to reveal
				}
				toggleExpanded(node.id);
				if (!filesByGroupId.has(node.id)) {
					postToHost({ type: 'architecture:requestFiles', groupId: node.id });
				}
				return;
			}

			const visibleNodeIds = new Set(visibleDiagramModel(mergedArchitectureModel, expandedArchNodeIds).nodes.map((candidate) => candidate.id));
			if (hasHiddenStandaloneImports(mergedArchitectureModel, node.id, visibleNodeIds)) {
				toggleExpanded(node.id);
				return;
			}
			postToHost({ type: 'architecture:openFileFlow', fileId: node.id });
		},
		[mergedArchitectureModel, expandedArchNodeIds, filesByGroupId, toggleExpanded]
	);

	const handleFlatFileNodeClick: NodeMouseHandler = useCallback((_event, node) => {
		setSelectedCardId(node.id);
		postToHost({ type: 'architecture:openFileFlow', fileId: node.id });
	}, []);

	const handleSelectLayers = useCallback(() => {
		setViewMode('layers');
		setSelectedCardId(undefined);
	}, []);

	const handleSelectFiles = useCallback(() => {
		setViewMode('files');
		setSelectedCardId(undefined);
		if (!flatFiles) {
			postToHost({ type: 'architecture:requestFlatFiles' });
		}
	}, [flatFiles]);

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
				: viewMode === 'files'
				  ? { level: 'files' }
				  : { level: 'layers', expandedGroupIds: [...expandedArchNodeIds].filter((id) => filesByGroupId.has(id)) };
		postToHost({ type: 'graph:exportRequest', view });
	}, [viewMode, focusNodeId, expandedNodeIds, expandedArchNodeIds, filesByGroupId]);

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
				breadcrumb={
					<Breadcrumb
						viewMode={viewMode}
						symbolLabel={graph?.nodes.find((n) => n.id === focusNodeId)?.name}
						onSelectLayers={handleSelectLayers}
						onSelectFiles={handleSelectFiles}
					/>
				}
				exportToolbar={exportToolbar}
				containerRef={diagramContainerRef}
			/>
		);
	}

	if (viewMode === 'files') {
		return (
			<DiagramLevelView
				model={flatFiles?.model ?? EMPTY_DIAGRAM_MODEL}
				entryPointIds={flatFileEntryPointIds}
				labelsByGroupId={EMPTY_LABELS}
				loadingMessage={!flatFiles ? 'Loading files…' : undefined}
				selectedId={selectedCardId}
				expandedNodeIds={EMPTY_ARCH_NODE_IDS}
				onNodeClick={handleFlatFileNodeClick}
				onPaneClick={() => setSelectedCardId(undefined)}
				breadcrumb={<Breadcrumb viewMode={viewMode} onSelectLayers={handleSelectLayers} onSelectFiles={handleSelectFiles} />}
				onExportClick={handleExportClick}
				isExporting={isExporting}
				containerRef={diagramContainerRef}
			/>
		);
	}

	return (
		<DiagramLevelView
			model={mergedArchitectureModel}
			entryPointIds={mergedEntryPointIds}
			labelsByGroupId={architecture.labelsByGroupId}
			loadingMessage={!graph ? 'Loading Atlas…' : undefined}
			selectedId={selectedCardId}
			expandedNodeIds={expandedArchNodeIds}
			onNodeClick={handleArchNodeClick}
			onPaneClick={() => setSelectedCardId(undefined)}
			breadcrumb={<Breadcrumb viewMode={viewMode} onSelectLayers={handleSelectLayers} onSelectFiles={handleSelectFiles} />}
			onExportClick={handleExportClick}
			isExporting={isExporting}
			containerRef={diagramContainerRef}
		/>
	);
}

interface BreadcrumbProps {
	viewMode: ViewMode;
	symbolLabel?: string;
	onSelectLayers: () => void;
	onSelectFiles: () => void;
}

function Breadcrumb({ viewMode, symbolLabel, onSelectLayers, onSelectFiles }: BreadcrumbProps): ReactElement {
	const items: { key: string; label: string; current: boolean; onClick?: () => void }[] = [
		{ key: 'layers', label: 'Layers', current: viewMode === 'layers', onClick: viewMode === 'layers' ? undefined : onSelectLayers },
		{ key: 'files', label: 'Files', current: viewMode === 'files', onClick: viewMode === 'files' ? undefined : onSelectFiles }
	];
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
	model: DiagramModel;
	entryPointIds: ReadonlySet<string>;
	labelsByGroupId: Record<string, ArchitectureLayerLabel>;
	loadingMessage: string | undefined;
	selectedId: string | undefined;
	/**
	 * Expanded node ids: a folder group whose member files `model` already
	 * has merged in as its children (see App's `mergedArchitectureModel`), or
	 * a merged-in file whose own standalone import targets (a file with no
	 * outgoing edges of its own — see ../diagramFileExpansion) should now be
	 * visible. `onNodeClick` toggles membership for a card that has either
	 * kind of hidden children.
	 */
	expandedNodeIds: ReadonlySet<string>;
	onNodeClick: NodeMouseHandler;
	/** Clicking the canvas background clears the selection so the whole diagram returns to full opacity — the counterpart to `onNodeClick` dimming everything but the clicked node's direct relationships. */
	onPaneClick: () => void;
	breadcrumb: ReactElement;
	onExportClick: () => void;
	isExporting: boolean;
	containerRef: RefObject<HTMLDivElement>;
}

function DiagramLevelView({ model, entryPointIds, labelsByGroupId, loadingMessage, selectedId, expandedNodeIds, onNodeClick, onPaneClick, breadcrumb, onExportClick, isExporting, containerRef }: DiagramLevelViewProps): ReactElement {
	const visibleModel = useMemo(() => visibleDiagramModel(model, expandedNodeIds), [model, expandedNodeIds]);

	const orderedNodes = useMemo(() => topologicallyOrderNodes(visibleModel), [visibleModel]);

	const hasChildrenById = useMemo(() => {
		const result = new Set<string>();
		for (const node of orderedNodes) {
			if (node.parentId) {
				result.add(node.parentId);
			}
		}
		return result;
	}, [orderedNodes]);

	const boxes = useMemo(
		() =>
			computeDiagramLayout(
				orderedNodes.map((node) => {
					const isGroupContainer = node.kind === 'group' && hasChildrenById.has(node.id);
					if (isGroupContainer) {
						return { id: node.id, parentId: node.parentId };
					}
					const hasPurpose = Boolean(labelsByGroupId[node.id]?.description);
					return { id: node.id, parentId: node.parentId, height: estimateDiagramCardHeight(hasPurpose, node.metrics, false) };
				}),
				visibleModel.edges
			),
		[orderedNodes, visibleModel, hasChildrenById, labelsByGroupId]
	);

	const siblingIndexById = useMemo(() => computeSiblingIndex(orderedNodes), [orderedNodes]);

	const visibleNodeIds = useMemo(() => new Set(orderedNodes.map((node) => node.id)), [orderedNodes]);

	const highlighted = useMemo(() => connectedNodeIds(visibleModel.edges, selectedId), [visibleModel, selectedId]);

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
				const isExpanded = expandedNodeIds.has(node.id);
				const isDimmed = highlighted !== undefined && !highlighted.has(node.id);
				// A folder group's hidden children are its own member files, not yet fetched/merged (App's mergedArchitectureModel); a file's are its standalone import targets (../diagramFileExpansion).
				const hasHiddenChildren = node.kind === 'group' ? Boolean(node.metrics) && !isExpanded : hasHiddenStandaloneImports(model, node.id, visibleNodeIds);
				if (isGroupContainer) {
					const data: DiagramGroupData = {
						label: labelsByGroupId[node.id]?.label ?? node.label,
						purpose: labelsByGroupId[node.id]?.description,
						hasEntryPoint: entryPointIds.has(node.id),
						tintIndex: siblingIndexById.get(node.id) ?? 0,
						hasHiddenChildren,
						isExpanded,
						isDimmed
					};
					return { ...base, type: 'diagramGroup', data };
				}
				const data: DiagramCardData = {
					kind: node.kind as DiagramCardData['kind'],
					label: labelsByGroupId[node.id]?.label ?? node.label,
					purpose: labelsByGroupId[node.id]?.description,
					metrics: node.metrics,
					hasEntryPoint: entryPointIds.has(node.id),
					isSelected: node.id === selectedId,
					isDimmed,
					hasHiddenChildren,
					isExpanded,
					showFanMetrics: false
				};
				return { ...base, type: 'diagramCard', data };
			}),
		[orderedNodes, boxes, hasChildrenById, siblingIndexById, labelsByGroupId, entryPointIds, selectedId, highlighted, model, expandedNodeIds, visibleNodeIds]
	);

	const { nodes: draggableNodes, onNodesChange, resetLayout } = useDraggableLayout(flowNodes);

	const flowEdges: Edge[] = useMemo(
		() =>
			visibleModel.edges.map((edge) => {
				const dominant = dominantEdgeKind(edge.kinds);
				const totalCount = edge.kinds.reduce((sum, entry) => sum + entry.count, 0);
				const isDimmed = highlighted !== undefined && !(edge.source === selectedId || edge.target === selectedId);
				return {
					id: edge.id,
					source: edge.source,
					target: edge.target,
					type: 'default',
					className: `${DIAGRAM_EDGE_VISUALS[dominant].className} ${isDimmed ? 'is-dimmed' : ''}`,
					label: String(totalCount),
					labelBgStyle: { fill: 'var(--vscode-editorWidget-background)' },
					labelStyle: { fontSize: 10, fill: 'var(--vscode-editorWidget-foreground)' },
					markerEnd: { type: MarkerType.ArrowClosed }
				};
			}),
		[visibleModel, highlighted, selectedId]
	);

	return (
		<div className="app-root">
			{breadcrumb}
			{loadingMessage && <EmptyState message={loadingMessage} />}
			{!loadingMessage && flowNodes.length === 0 && <EmptyState message='No nodes to display yet. Run "Atlas: Analyze Workspace" first.' />}
			{!loadingMessage && flowNodes.length > 0 && (
				<div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
					<DiagramToolbar onExport={onExportClick} exportDisabled={isExporting} onResetLayout={resetLayout} />
					<ReactFlow
						nodes={draggableNodes}
						edges={flowEdges}
						nodeTypes={DIAGRAM_NODE_TYPES}
						onNodesChange={onNodesChange}
						onNodeClick={onNodeClick}
						onPaneClick={onPaneClick}
						fitView
						nodesConnectable={false}
						proOptions={{ hideAttribution: true }}
					>
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
			{!graph && <EmptyState message="Loading Atlas…" />}
			{graph && visible.nodes.length === 0 && (
				<EmptyState message='No nodes to display yet. Run "Atlas: Analyze Workspace" first.' />
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
		</div>
	);
}
