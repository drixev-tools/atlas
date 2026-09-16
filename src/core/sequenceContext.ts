// Call context for the "Show Sequence Diagram" action: the extraction
// pipelines don't emit a dedicated call-graph edge kind (only `contains`,
// `imports`, `exports` — see ../pipelines/model), so a function/file's
// incoming/outgoing calls are approximated from what the Project Graph
// already tracks — files that import (or are imported by) the target's file,
// plus symbols declared alongside the target in the same file. Same proxy
// ../ui/impact already relies on for "Calculate Impact", via
// getStructuralConsumers/getStructuralDependencies below.
import * as path from 'path';
import { NodeKind } from '../pipelines/model';
import { getStructuralConsumers, getStructuralDependencies } from './impact';
import { ProjectGraphStore, StoredNode } from './store';

export interface SequenceParticipant {
	id: string;
	name: string;
	kind: NodeKind;
	filePath?: string;
}

export interface SequenceContext {
	target: SequenceParticipant;
	/** Other symbols declared directly in the target's own file (the target's own children when it's a file), excluding the target itself. */
	siblings: SequenceParticipant[];
	/** Files that directly import the target's file — likely callers. */
	callers: SequenceParticipant[];
	/** Files the target's file directly imports — likely callees. */
	callees: SequenceParticipant[];
}

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

function toParticipant(node: StoredNode): SequenceParticipant {
	const participant: SequenceParticipant = { id: node.id, name: node.name, kind: node.kind };
	if (node.filePath) {
		participant.filePath = node.filePath;
	}
	return participant;
}

/**
 * Builds `nodeId`'s call context for the "Show Sequence Diagram" action.
 * Only meaningful for `function` and `file` nodes, matching that action's own
 * scope (../ui/sequenceDiagram); returns `undefined` for any other kind or an
 * id no longer in the Project Graph.
 */
export function buildSequenceContext(store: ProjectGraphStore, nodeId: string): SequenceContext | undefined {
	const target = store.getNode(nodeId);
	if (!target || (target.kind !== 'function' && target.kind !== 'file')) {
		return undefined;
	}

	const fileId = target.kind === 'file' ? target.id : target.filePath ? fileNodeId(target.filePath) : undefined;
	const fileNode = fileId ? store.getNode(fileId) : undefined;

	const siblings = fileId
		? store
				.listEdges({ kind: 'contains', source: fileId })
				.map((edge) => store.getNode(edge.target))
				.filter((node): node is StoredNode => node !== undefined && node.id !== target.id)
				.map(toParticipant)
		: [];

	const callers = fileNode ? getStructuralConsumers(store, fileNode.id, { maxDepth: 1 }).map(toParticipant) : [];
	const callees = fileNode ? getStructuralDependencies(store, fileNode.id, { maxDepth: 1 }).map(toParticipant) : [];

	return { target: toParticipant(target), siblings, callers, callees };
}
