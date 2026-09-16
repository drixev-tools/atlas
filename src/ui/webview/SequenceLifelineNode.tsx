// React Flow node renderer for the sequence diagram view (./SequenceDiagramApp):
// one lifeline — a card header pinned at the top plus a dashed vertical track
// below it, both styled like ./DiagramCardNode's leaf card (same
// ./visualSystem per-kind accent/icon). Every message touching this lifeline
// becomes a named `Handle` positioned at its step's row (../sequenceDiagramLayout
// already computed each handle's `top`/`side`), rather than a fixed
// left/right pair, since a lifeline can send and receive many messages at
// different heights.
import type { ReactElement } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { SequenceHandleLayout, SequenceHandleSide } from '../sequenceDiagramLayout';
import { DIAGRAM_KIND_VISUALS } from './visualSystem';

const HEADER_HEIGHT = 56;

function toPosition(side: SequenceHandleSide): Position {
	return side === 'left' ? Position.Left : Position.Right;
}

export interface SequenceLifelineData extends Record<string, unknown> {
	label: string;
	kind: 'file' | 'class';
	isTarget: boolean;
	totalHeight: number;
	sourceHandles: SequenceHandleLayout[];
	targetHandles: SequenceHandleLayout[];
	canOpen: boolean;
	onOpen: (lifelineId: string) => void;
}

export type SequenceLifelineFlowNode = Node<SequenceLifelineData, 'sequenceLifeline'>;

export function SequenceLifelineNode(props: NodeProps<SequenceLifelineFlowNode>): ReactElement {
	const { id, data } = props;
	const visual = DIAGRAM_KIND_VISUALS[data.kind];

	return (
		<div className={`ag-sequence-lifeline ${visual.accentClassName}`}>
			<div
				className={`ag-card ag-sequence-lifeline-header ${data.isTarget ? 'is-selected' : ''} ${data.canOpen ? 'is-clickable' : ''}`}
				title={data.label}
				onClick={() => data.canOpen && data.onOpen(id)}
			>
				<span className="ag-card-icon" aria-hidden="true">
					{visual.icon}
				</span>
				<span className="ag-card-title">{data.label}</span>
				{data.isTarget && <span className="ag-card-entry-badge">Target</span>}
			</div>
			<div className="ag-sequence-lifeline-track" style={{ height: data.totalHeight - HEADER_HEIGHT }} />
			{data.sourceHandles.map((handle) => (
				<Handle key={handle.id} id={handle.id} type="source" position={toPosition(handle.side)} style={{ top: handle.top }} />
			))}
			{data.targetHandles.map((handle) => (
				<Handle key={handle.id} id={handle.id} type="target" position={toPosition(handle.side)} style={{ top: handle.top }} />
			))}
		</div>
	);
}
