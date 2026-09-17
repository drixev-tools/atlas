// Root React component of the "Identified Architecture" webview: a second,
// separate diagram from "Open Architecture" (./App.tsx), rendering the
// role-grouped `DiagramModel` Claude produced
// (../identifiedArchitecture) with the same card/group node types and
// left-to-right layout ./App.tsx's layers level uses. Always AI-generated —
// unlike the sequence/impact views, there is no non-AI fallback content here,
// so the view has its own "needs an API key configured" and "nothing
// identified yet" empty states instead of degrading gracefully in place.
// `AiInterpretationBadge` sits inside the captured diagram container itself
// (not just the page chrome around it) so the AI-interpretation marking
// survives into the SVG/PNG/PDF export, not just the live view.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, type Edge, type NodeMouseHandler } from '@xyflow/react';
import { DiagramModel } from '../../core/diagramModel';
import { computeDiagramLayout } from '../diagramLayout';
import { DiagramCardData, DiagramCardFlowNode, DiagramCardNode, DiagramGroupData, DiagramGroupFlowNode, DiagramGroupNode } from './DiagramCardNode';
import { dominantEdgeKind, DIAGRAM_EDGE_VISUALS, estimateDiagramCardHeight } from './visualSystem';
import { ExportButton } from './ExportButton';
import { captureViewExport } from './exportCapture';
import { IdentifiedArchitectureExportFormat, IdentifiedArchitectureHostToWebviewMessage, IdentifiedArchitecturePayload } from './identifiedArchitectureProtocol';
import { postToHost } from './vscodeApi';

const DIAGRAM_NODE_TYPES = { diagramCard: DiagramCardNode, diagramGroup: DiagramGroupNode };

const EMPTY_MODEL: DiagramModel = { nodes: [], edges: [] };

type ViewStatus = 'loading' | 'needsApiKey' | 'empty' | 'ready';

export function IdentifiedArchitectureApp(): ReactElement {
	const [payload, setPayload] = useState<IdentifiedArchitecturePayload | undefined>(undefined);
	const [status, setStatus] = useState<ViewStatus>('loading');
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

	const [isExporting, setIsExporting] = useState(false);
	const diagramContainerRef = useRef<HTMLDivElement>(null);

	const handleExportCapture = useCallback(async (format: IdentifiedArchitectureExportFormat) => {
		const element = diagramContainerRef.current;
		if (!element) {
			postToHost({ type: 'identifiedArchitecture:exportCaptureFailed' });
			return;
		}
		setIsExporting(true);
		try {
			const captured = await captureViewExport(element, format);
			postToHost({ type: 'identifiedArchitecture:exportCaptured', format, ...captured });
		} catch {
			postToHost({ type: 'identifiedArchitecture:exportCaptureFailed' });
		} finally {
			setIsExporting(false);
		}
	}, []);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<IdentifiedArchitectureHostToWebviewMessage>): void => {
			const message = event.data;
			if (message.type === 'identifiedArchitecture:update') {
				setPayload(message.payload);
				setStatus('ready');
				setSelectedId(undefined);
			} else if (message.type === 'identifiedArchitecture:needsApiKey') {
				setPayload(undefined);
				setStatus('needsApiKey');
			} else if (message.type === 'identifiedArchitecture:loading') {
				setPayload(undefined);
				setStatus('loading');
			} else if (message.type === 'identifiedArchitecture:empty') {
				setPayload(undefined);
				setStatus('empty');
			} else if (message.type === 'identifiedArchitecture:exportCapture') {
				void handleExportCapture(message.format);
			}
		};
		window.addEventListener('message', handleMessage);
		postToHost({ type: 'identifiedArchitecture:ready' });
		return () => window.removeEventListener('message', handleMessage);
	}, [handleExportCapture]);

	const handleExportClick = useCallback(() => postToHost({ type: 'identifiedArchitecture:exportRequest' }), []);
	const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => setSelectedId(node.id), []);

	const model = payload?.model ?? EMPTY_MODEL;

	const orderedNodes = useMemo(() => topologicallyOrderNodes(model), [model]);
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
					return isGroupContainer
						? { id: node.id, parentId: node.parentId }
						: { id: node.id, parentId: node.parentId, height: estimateDiagramCardHeight(false, node.metrics) };
				}),
				model.edges
			),
		[orderedNodes, model, hasChildrenById]
	);
	const siblingIndexById = useMemo(() => computeSiblingIndex(orderedNodes), [orderedNodes]);

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
						label: node.label,
						purpose: payload?.roleDescriptionsByGroupId[node.id],
						hasEntryPoint: false,
						tintIndex: siblingIndexById.get(node.id) ?? 0
					};
					return { ...base, type: 'diagramGroup', data };
				}
				const data: DiagramCardData = {
					kind: node.kind as DiagramCardData['kind'],
					label: node.label,
					metrics: node.metrics,
					hasEntryPoint: false,
					isSelected: node.id === selectedId
				};
				return { ...base, type: 'diagramCard', data };
			}),
		[orderedNodes, boxes, hasChildrenById, siblingIndexById, payload, selectedId]
	);

	const flowEdges: Edge[] = useMemo(
		() =>
			model.edges.map((edge) => {
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
			<ExportButton onClick={handleExportClick} disabled={isExporting || status !== 'ready'} />
			{status === 'needsApiKey' && <NeedsApiKeyState />}
			{status === 'loading' && <EmptyState message="Identifying the project's architecture…" />}
			{status === 'empty' && (
				<EmptyState message='No architecture identified yet. Run "Project Graph: Analyze Workspace" first, then try again.' />
			)}
			{status === 'ready' && payload && (
				<div ref={diagramContainerRef} className="ag-identified-architecture-canvas" style={{ width: '100%', height: '100%' }}>
					<AiInterpretationBadge patternName={payload.patternName} patternDescription={payload.patternDescription} />
					<ReactFlow
						nodes={flowNodes}
						edges={flowEdges}
						nodeTypes={DIAGRAM_NODE_TYPES}
						onNodeClick={handleNodeClick}
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

function AiInterpretationBadge({ patternName, patternDescription }: { patternName: string; patternDescription: string }): ReactElement {
	return (
		<div className="ag-ai-architecture-badge" title={patternDescription}>
			<span className="ag-ai-architecture-badge-tag">AI interpretation</span>
			<span className="ag-ai-architecture-badge-pattern">{patternName}</span>
		</div>
	);
}

function NeedsApiKeyState(): ReactElement {
	return (
		<div className="empty-state">
			<p>Identifying the architecture needs an Anthropic API key.</p>
			<button type="button" className="ag-flow-card-open" onClick={() => postToHost({ type: 'identifiedArchitecture:openAiSettings' })}>
				Configure AI Settings
			</button>
		</div>
	);
}

function EmptyState({ message }: { message: string }): ReactElement {
	return <div className="empty-state">{message}</div>;
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
