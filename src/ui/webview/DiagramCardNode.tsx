// React Flow node renderers for the architecture view's "layers" and
// "files" levels (./App.tsx): `DiagramCardNode` for a leaf node (a file,
// class, method, function, or a group with no nested subgroups) rendered as
// a rich card, and `DiagramGroupNode` for a group that nests other groups —
// rendered as a bordered, tinted container around its (independently
// positioned, `parentId`-linked) children rather than a card of its own.
// Both read their per-kind accent from ./visualSystem, the one place that
// mapping is defined so the flow/sequence views planned next in Fase 1.3
// can reuse it.
import type { ReactElement } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { DiagramMetrics } from '../../core/diagramModel';
import { DIAGRAM_KIND_VISUALS, DiagramCardKind, layerTintClassName } from './visualSystem';

export interface DiagramCardData extends Record<string, unknown> {
	kind: DiagramCardKind;
	label: string;
	purpose?: string;
	metrics?: DiagramMetrics;
	hasEntryPoint: boolean;
	isSelected: boolean;
	/** Whether this card imports a standalone file (../diagramFileExpansion) not currently on canvas — the files view's cue that clicking this card expands it instead of opening the Entry Point Flow view. */
	hasHiddenChildren?: boolean;
	isExpanded?: boolean;
}

export type DiagramCardFlowNode = Node<DiagramCardData, 'diagramCard'>;

function MetricChips({ metrics }: { metrics: DiagramMetrics }): ReactElement {
	return (
		<div className="ag-card-metrics">
			{metrics.fileCount > 1 && <span className="ag-chip">{metrics.fileCount} files</span>}
			{metrics.symbolCount > 0 && <span className="ag-chip">{metrics.symbolCount} symbols</span>}
			<span className="ag-chip">{metrics.fanIn}→ ·  →{metrics.fanOut}</span>
			{metrics.changedFileCount > 0 && <span className="ag-chip">{metrics.changedFileCount} changed</span>}
			{metrics.externalDependencies.slice(0, 3).map((dependency) => (
				<span key={dependency.name} className="ag-chip ag-chip-external" title={`${dependency.name} (${dependency.count})`}>
					<span aria-hidden="true">↗</span> {dependency.name}
				</span>
			))}
		</div>
	);
}

function EntryBadge(): ReactElement {
	return (
		<span className="ag-card-entry-badge">
			<span aria-hidden="true">★</span> Entry
		</span>
	);
}

export function DiagramCardNode(props: NodeProps<DiagramCardFlowNode>): ReactElement {
	const { data } = props;
	const visual = DIAGRAM_KIND_VISUALS[data.kind];

	return (
		<div className={`ag-card ${visual.accentClassName} ${data.isSelected ? 'is-selected' : ''}`} title={data.purpose || data.label}>
			<Handle type="target" position={Position.Left} />
			<div className="ag-card-header">
				<span className="ag-card-icon" aria-hidden="true">
					{visual.icon}
				</span>
				<span className="ag-card-title">{data.label}</span>
				{data.hasEntryPoint && <EntryBadge />}
			</div>
			{data.purpose && <div className="ag-card-purpose">{data.purpose}</div>}
			{data.metrics && <MetricChips metrics={data.metrics} />}
			{data.hasHiddenChildren && (
				<div className="ag-card-hint" aria-hidden="true">
					{data.isExpanded ? '−' : '+'}
				</div>
			)}
			<Handle type="source" position={Position.Right} />
		</div>
	);
}

export interface DiagramGroupData extends Record<string, unknown> {
	label: string;
	purpose?: string;
	hasEntryPoint: boolean;
	tintIndex: number;
	/** Whether this folder owns member files (../diagramFileExpansion's containment-based hiding) not yet merged onto the canvas — the layers view's cue that clicking this box expands it. */
	hasHiddenChildren?: boolean;
	isExpanded?: boolean;
}

export type DiagramGroupFlowNode = Node<DiagramGroupData, 'diagramGroup'>;

export function DiagramGroupNode(props: NodeProps<DiagramGroupFlowNode>): ReactElement {
	const { data } = props;

	return (
		<div className={`ag-group-node ${layerTintClassName(data.tintIndex)}`} title={data.purpose || data.label}>
			<Handle type="target" position={Position.Left} />
			<div className="ag-group-node-header">
				<span>{data.label}</span>
				{data.hasEntryPoint && <EntryBadge />}
			</div>
			{data.hasHiddenChildren && (
				<div className="ag-card-hint" aria-hidden="true">
					{data.isExpanded ? '−' : '+'}
				</div>
			)}
			<Handle type="source" position={Position.Right} />
		</div>
	);
}
