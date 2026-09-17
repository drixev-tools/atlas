// React Flow node renderer for the active-file flow view (./ActiveFileFlowApp):
// a single file in the flow, styled like ./DiagramCardNode's leaf card (same
// ./visualSystem per-kind accent/icon) but left-right handled for a flow
// rather than sized for metrics, plus this view's own affordances — opening
// the file, a "Start" badge for a flow origin, and dimming for a file that's
// merely notified (the active file's own imports) rather than part of the
// highlighted chain leading to it.
import type { ReactElement } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { NodeKind } from '../../pipelines/model';
import { DIAGRAM_KIND_VISUALS, DiagramCardKind, DiagramKindVisual } from './visualSystem';

const FALLBACK_VISUAL: DiagramKindVisual = { icon: '•', label: 'Symbol', accentClassName: 'ag-accent-file' };

function visualForKind(kind: NodeKind): DiagramKindVisual {
	return (DIAGRAM_KIND_VISUALS as Partial<Record<NodeKind, DiagramKindVisual>>)[kind] ?? FALLBACK_VISUAL;
}

export interface FlowCardData extends Record<string, unknown> {
	kind: NodeKind;
	label: string;
	filePath?: string;
	isRoot: boolean;
	isActive: boolean;
	isHighlighted: boolean;
	onOpen: (nodeId: string) => void;
}

export type FlowCardFlowNode = Node<FlowCardData, 'flowCard'>;

export function FlowCardNode(props: NodeProps<FlowCardFlowNode>): ReactElement {
	const { id, data } = props;
	const visual = visualForKind(data.kind);
	const classNames = ['ag-card', 'ag-flow-card', visual.accentClassName, data.isActive ? 'is-selected' : '', data.isHighlighted ? '' : 'is-dimmed']
		.filter(Boolean)
		.join(' ');

	return (
		<div className={classNames} title={data.filePath ?? data.label}>
			<Handle type="target" position={Position.Left} />
			<div className="ag-card-header">
				<span className="ag-card-icon" aria-hidden="true">
					{visual.icon}
				</span>
				<span className="ag-card-title">{data.label}</span>
				{data.isRoot && <span className="ag-card-entry-badge">Start</span>}
			</div>
			{data.filePath && (
				<button
					type="button"
					className="ag-flow-card-open"
					title="Open file"
					onClick={(event) => {
						event.stopPropagation();
						data.onOpen(id);
					}}
				>
					Open file &#8599;
				</button>
			)}
			<Handle type="source" position={Position.Right} />
		</div>
	);
}
