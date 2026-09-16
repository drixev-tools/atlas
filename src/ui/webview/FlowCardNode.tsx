// React Flow node renderer for the entry-point flow view (./EntryPointFlowApp):
// a single step in the call chain, styled like ./DiagramCardNode's leaf card
// (same ./visualSystem per-kind accent/icon) but left-right handled for a
// flow rather than sized for metrics, plus this view's own affordances —
// opening the node's file/line, and a collapse hint for a callee not yet
// expanded into view.
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
	isEntryPoint: boolean;
	isSelected: boolean;
	hasCollapsedChildren: boolean;
	isExpanded: boolean;
	onOpen: (nodeId: string) => void;
}

export type FlowCardFlowNode = Node<FlowCardData, 'flowCard'>;

export function FlowCardNode(props: NodeProps<FlowCardFlowNode>): ReactElement {
	const { id, data } = props;
	const visual = visualForKind(data.kind);

	return (
		<div className={`ag-card ag-flow-card ${visual.accentClassName} ${data.isSelected ? 'is-selected' : ''}`} title={data.filePath ?? data.label}>
			<Handle type="target" position={Position.Left} />
			<div className="ag-card-header">
				<span className="ag-card-icon" aria-hidden="true">
					{visual.icon}
				</span>
				<span className="ag-card-title">{data.label}</span>
				{data.isEntryPoint && <span className="ag-card-entry-badge">Entry</span>}
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
			{data.hasCollapsedChildren && (
				<div className="ag-flow-card-hint" aria-hidden="true">
					{data.isExpanded ? '−' : '+'}
				</div>
			)}
			<Handle type="source" position={Position.Right} />
		</div>
	);
}
