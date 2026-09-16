// Root React component of the sequence diagram webview (Fase 1.3, Epic P):
// vertical lifelines with horizontal messages between them, replacing Epic
// I's HTML step list. The diagram itself — lifelines, participants, steps,
// and their order — comes straight from ../sequenceDiagram's view state,
// valid with or without Claude; only `summary` and each step's `label` ever
// change with `aiGenerated`. Layout is ../sequenceDiagramLayout's pure
// geometry; this component only turns that into React Flow nodes/edges and
// wires the "open lifeline"/"open AI settings" affordances.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Background, ReactFlow, type Edge } from '@xyflow/react';
import { computeSequenceDiagramLayout } from '../sequenceDiagramLayout';
import { SequenceDiagramExportFormat, SequenceDiagramHostToWebviewMessage } from './sequenceDiagramProtocol';
import { SequenceLifelineData, SequenceLifelineFlowNode, SequenceLifelineNode } from './SequenceLifelineNode';
import { DIAGRAM_EDGE_VISUALS } from './visualSystem';
import { postToHost } from './vscodeApi';
import { SequenceDiagramViewState } from '../sequenceDiagram';
import { ExportButton } from './ExportButton';
import { captureViewExport } from './exportCapture';

const LIFELINE_WIDTH = 200;

const SEQUENCE_NODE_TYPES = { sequenceLifeline: SequenceLifelineNode };

export function SequenceDiagramApp(): ReactElement {
	const [state, setState] = useState<SequenceDiagramViewState | undefined>(undefined);

	const [isExporting, setIsExporting] = useState(false);
	const diagramContainerRef = useRef<HTMLDivElement>(null);

	const handleExportCapture = useCallback(async (format: SequenceDiagramExportFormat) => {
		const element = diagramContainerRef.current;
		if (!element) {
			postToHost({ type: 'sequenceDiagram:exportCaptureFailed' });
			return;
		}
		setIsExporting(true);
		try {
			const captured = await captureViewExport(element, format);
			postToHost({ type: 'sequenceDiagram:exportCaptured', format, ...captured });
		} catch {
			postToHost({ type: 'sequenceDiagram:exportCaptureFailed' });
		} finally {
			setIsExporting(false);
		}
	}, []);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<SequenceDiagramHostToWebviewMessage>): void => {
			const message = event.data;
			if (message.type === 'sequenceDiagram:state') {
				const { type: _type, ...rest } = message;
				setState(rest);
			} else if (message.type === 'sequenceDiagram:exportCapture') {
				void handleExportCapture(message.format);
			}
		};
		window.addEventListener('message', handleMessage);
		postToHost({ type: 'sequenceDiagram:ready' });
		return () => window.removeEventListener('message', handleMessage);
	}, [handleExportCapture]);

	const handleExportClick = useCallback(() => {
		postToHost({ type: 'sequenceDiagram:exportRequest' });
	}, []);

	const lifelineIds = useMemo(() => state?.lifelines.map((lifeline) => lifeline.id) ?? [], [state]);

	const participantsById = useMemo(() => new Map((state?.participants ?? []).map((participant) => [participant.id, participant] as const)), [state]);

	const layout = useMemo(
		() =>
			computeSequenceDiagramLayout(
				lifelineIds,
				(state?.steps ?? []).map((step) => ({
					id: step.id,
					order: step.order,
					sourceLifelineId: participantsById.get(step.fromParticipantId)?.lifelineId ?? step.fromParticipantId,
					targetLifelineId: participantsById.get(step.toParticipantId)?.lifelineId ?? step.toParticipantId
				})),
				{ lifelineSpacing: LIFELINE_WIDTH + 20 }
			),
		[lifelineIds, state, participantsById]
	);

	const handleOpenLifeline = (lifelineId: string): void => postToHost({ type: 'sequenceDiagram:openLifeline', lifelineId });

	const flowNodes: SequenceLifelineFlowNode[] = useMemo(
		() =>
			(state?.lifelines ?? []).map((lifeline) => {
				const laidOut = layout.lifelinesById.get(lifeline.id);
				const data: SequenceLifelineData = {
					label: lifeline.label,
					kind: lifeline.kind,
					isTarget: lifeline.id === state?.targetLifelineId,
					totalHeight: laidOut?.totalHeight ?? 0,
					sourceHandles: laidOut?.sourceHandles ?? [],
					targetHandles: laidOut?.targetHandles ?? [],
					canOpen: Boolean(lifeline.filePath),
					onOpen: handleOpenLifeline
				};
				return {
					id: lifeline.id,
					type: 'sequenceLifeline',
					position: { x: laidOut?.x ?? 0, y: 0 },
					style: { width: LIFELINE_WIDTH, height: laidOut?.totalHeight ?? 0 },
					draggable: false,
					data
				};
			}),
		[state, layout]
	);

	const labelByStepId = useMemo(() => new Map((state?.steps ?? []).map((step) => [step.id, step.label] as const)), [state]);

	const flowEdges: Edge[] = useMemo(
		() =>
			layout.steps.map((step) => ({
				id: step.id,
				source: step.sourceLifelineId,
				target: step.targetLifelineId,
				sourceHandle: step.sourceHandleId,
				targetHandle: step.targetHandleId,
				type: step.isSelfMessage ? 'default' : 'straight',
				label: labelByStepId.get(step.id),
				className: DIAGRAM_EDGE_VISUALS.calls.className,
				labelBgStyle: { fill: 'var(--vscode-editorWidget-background)' },
				labelStyle: { fontSize: 11 }
			})),
		[layout, labelByStepId]
	);

	if (!state) {
		return (
			<div className="app-root">
				<div className="empty-state">Loading sequence diagram...</div>
			</div>
		);
	}

	return (
		<div className="app-root">
			<SequenceSummary state={state} />
			<ExportButton onClick={handleExportClick} disabled={isExporting} />
			<div ref={diagramContainerRef} style={{ width: '100%', height: '100%' }}>
				<ReactFlow
					key={state.targetId}
					nodes={flowNodes}
					edges={flowEdges}
					nodeTypes={SEQUENCE_NODE_TYPES}
					nodesDraggable={false}
					fitView
					proOptions={{ hideAttribution: true }}
				>
					<Background />
				</ReactFlow>
			</div>
		</div>
	);
}

function SequenceSummary({ state }: { state: SequenceDiagramViewState }): ReactElement {
	return (
		<div className="ag-breadcrumb ag-sequence-summary">
			<span className="ag-card-title">
				{state.targetName} ({state.targetKind})
			</span>
			<span>{state.summary}</span>
			{state.truncated && <span className="ag-chip">Truncated</span>}
			{!state.aiGenerated && (
				<button type="button" className="ag-flow-card-open" onClick={() => postToHost({ type: 'sequenceDiagram:openAiSettings' })}>
					Enable AI narration
				</button>
			)}
		</div>
	);
}
