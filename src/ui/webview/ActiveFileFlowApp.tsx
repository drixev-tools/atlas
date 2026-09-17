// Root React component of the active-file flow webview: the upstream import
// chain that leads to whatever file is open in the editor (highlighted, and
// tracing back to its flow's root files), plus that file's own direct
// imports shown for context but left unhighlighted. Recomputed by the host
// (../activeFileFlowPanel) on every active-editor change; this component just
// renders whatever it's sent. Layout reuses ../graphLayout's existing dagre
// wrapper in its `LR` direction rather than a new algorithm, like the old
// entry-point flow view did.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Background, Controls, MarkerType, ReactFlow, type Edge } from '@xyflow/react';
import { ActiveFileFlow } from '../../core/activeFileFlow';
import { computeHierarchicalLayout } from '../graphLayout';
import { ActiveFileFlowExportFormat, ActiveFileFlowHostToWebviewMessage, ActiveFileFlowPayload } from './activeFileFlowProtocol';
import { FlowCardData, FlowCardFlowNode, FlowCardNode } from './FlowCardNode';
import { postToHost } from './vscodeApi';
import { ExportButton } from './ExportButton';
import { captureViewExport } from './exportCapture';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 76;

const FLOW_NODE_TYPES = { flowCard: FlowCardNode };

const DEFAULT_EMPTY_MESSAGE = 'Open a file to see its flow.';

function toActiveFileFlow(payload: ActiveFileFlowPayload): ActiveFileFlow {
	return {
		activeFileId: payload.activeFileId,
		nodes: payload.nodes,
		edges: payload.edges,
		highlightedIds: new Set(payload.highlightedIds),
		rootIds: new Set(payload.rootIds)
	};
}

export function ActiveFileFlowApp(): ReactElement {
	const [flow, setFlow] = useState<ActiveFileFlow | undefined>(undefined);
	const [emptyMessage, setEmptyMessage] = useState<string>(DEFAULT_EMPTY_MESSAGE);

	const [isExporting, setIsExporting] = useState(false);
	const diagramContainerRef = useRef<HTMLDivElement>(null);

	const handleExportCapture = useCallback(async (format: ActiveFileFlowExportFormat) => {
		const element = diagramContainerRef.current;
		if (!element) {
			postToHost({ type: 'activeFileFlow:exportCaptureFailed' });
			return;
		}
		setIsExporting(true);
		try {
			const captured = await captureViewExport(element, format);
			postToHost({ type: 'activeFileFlow:exportCaptured', format, ...captured });
		} catch {
			postToHost({ type: 'activeFileFlow:exportCaptureFailed' });
		} finally {
			setIsExporting(false);
		}
	}, []);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ActiveFileFlowHostToWebviewMessage>): void => {
			const message = event.data;
			if (message.type === 'activeFileFlow:update') {
				setFlow(toActiveFileFlow(message.flow));
			} else if (message.type === 'activeFileFlow:empty') {
				setFlow(undefined);
				setEmptyMessage(message.message);
			} else if (message.type === 'activeFileFlow:exportCapture') {
				void handleExportCapture(message.format);
			}
		};
		window.addEventListener('message', handleMessage);
		postToHost({ type: 'activeFileFlow:ready' });
		return () => window.removeEventListener('message', handleMessage);
	}, [handleExportCapture]);

	const handleExportClick = useCallback(() => {
		postToHost({ type: 'activeFileFlow:exportRequest' });
	}, []);

	const handleOpenNode = useCallback((nodeId: string) => {
		postToHost({ type: 'activeFileFlow:openNode', nodeId });
	}, []);

	const positions = useMemo(
		() =>
			flow
				? computeHierarchicalLayout(
						flow.nodes.map((node) => node.id),
						flow.edges.map((edge) => ({ source: edge.source, target: edge.target })),
						{ direction: 'LR', nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT }
				  )
				: new Map(),
		[flow]
	);

	const flowNodes: FlowCardFlowNode[] = useMemo(
		() =>
			(flow?.nodes ?? []).map((node) => {
				const position = positions.get(node.id) ?? { x: 0, y: 0 };
				const data: FlowCardData = {
					kind: node.kind,
					label: node.name,
					filePath: node.filePath,
					isRoot: flow?.rootIds.has(node.id) ?? false,
					isActive: node.id === flow?.activeFileId,
					isHighlighted: flow?.highlightedIds.has(node.id) ?? false,
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
		[flow, positions, handleOpenNode]
	);

	const flowEdges: Edge[] = useMemo(
		() =>
			(flow?.edges ?? []).map((edge) => {
				const isHighlighted = (flow?.highlightedIds.has(edge.source) && flow?.highlightedIds.has(edge.target)) ?? false;
				return {
					id: edge.id,
					source: edge.source,
					target: edge.target,
					markerEnd: { type: MarkerType.ArrowClosed },
					className: `ag-flow-edge ${isHighlighted ? 'is-highlighted' : 'is-dimmed'}`
				};
			}),
		[flow]
	);

	return (
		<div className="app-root">
			<ExportButton onClick={handleExportClick} disabled={isExporting || !flow} />
			{!flow && <EmptyState message={emptyMessage} />}
			{flow && flowNodes.length > 0 && (
				<div ref={diagramContainerRef} style={{ width: '100%', height: '100%' }}>
					<ReactFlow
						key={flow.activeFileId}
						nodes={flowNodes}
						edges={flowEdges}
						nodeTypes={FLOW_NODE_TYPES}
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

function EmptyState({ message }: { message: string }): ReactElement {
	return <div className="empty-state">{message}</div>;
}
