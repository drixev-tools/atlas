// Custom React Flow node renderer for a workflow-relevant Project Graph node
// (Epic E's `file`/`class`/`method`/`function` kinds only). Styling
// (background per `status`, border per `kind`) is driven entirely through
// CSS classes in ./styles.css rather than inline styles, matching this
// extension's convention of keeping presentation in stylesheets.
import type { ReactElement } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { GraphStatus } from '../../core/schema';
import { WorkflowNodeKind } from '../graphFilter';

export interface WorkflowNodeData extends Record<string, unknown> {
	label: string;
	kind: WorkflowNodeKind;
	status: GraphStatus;
	filePath: string | undefined;
	isFocused: boolean;
	isSelected: boolean;
	isExpanded: boolean;
	hasHiddenRelations: boolean;
}

export type WorkflowFlowNode = Node<WorkflowNodeData, 'workflowNode'>;

const KIND_LABEL: Record<WorkflowNodeKind, string> = {
	file: 'File',
	class: 'Class',
	method: 'Method',
	function: 'Function'
};

export function WorkflowNode(props: NodeProps<WorkflowFlowNode>): ReactElement {
	const { data } = props;
	const classNames = [
		'workflow-node',
		`kind-${data.kind}`,
		`status-${data.status}`,
		data.isFocused ? 'is-focused' : '',
		data.isSelected ? 'is-selected' : '',
		data.isExpanded ? 'is-expanded' : ''
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div className={classNames} title={data.filePath ?? data.label}>
			<Handle type="target" position={Position.Top} />
			<div className="workflow-node-kind">{KIND_LABEL[data.kind]}</div>
			<div className="workflow-node-label">{data.label}</div>
			{data.hasHiddenRelations && (
				<div className="workflow-node-hint" aria-hidden="true">
					{data.isExpanded ? '−' : '+'}
				</div>
			)}
			<Handle type="source" position={Position.Bottom} />
		</div>
	);
}
