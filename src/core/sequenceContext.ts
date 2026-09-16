// Call context for the "Show Sequence Diagram" action: a target function or
// file's call chain, built strictly from `calls` edges (Epic K/L's
// type-checker/ast-resolved call graph) instead of the import-based
// approximation this replaces. Participants are grouped into lifelines by
// class (when a method/function belongs to one) or by file otherwise, and
// steps are the target's own outgoing `calls` edges, ordered the way they
// actually happen in source code (`metadata.order`), depth-limited and
// cycle-safe like ../ui/entryPointFlow's traversal.
import * as path from 'path';
import { NodeKind, SourceRange } from '../pipelines/model';
import { ProjectGraphStore, StoredEdge, StoredNode } from './store';

export const DEFAULT_SEQUENCE_MAX_DEPTH = 4;
export const DEFAULT_SEQUENCE_MAX_STEPS = 12;

export type SequenceLifelineKind = 'file' | 'class';

export interface SequenceLifeline {
	id: string;
	label: string;
	kind: SequenceLifelineKind;
	filePath?: string;
	range?: SourceRange;
}

export interface SequenceParticipant {
	id: string;
	name: string;
	kind: NodeKind;
	lifelineId: string;
	filePath?: string;
}

export interface SequenceStep {
	id: string;
	order: number;
	fromParticipantId: string;
	toParticipantId: string;
	/** Default, non-AI label for this step, e.g. "calls foo" — what the view shows before/without a Claude-generated one. */
	action: string;
	line?: number;
}

export interface SequenceContext {
	target: SequenceParticipant;
	participants: SequenceParticipant[];
	lifelines: SequenceLifeline[];
	steps: SequenceStep[];
	/** True when the real chain continues beyond `maxDepth`/`maxSteps` and was cut off rather than fully shown. */
	truncated: boolean;
}

export interface SequenceContextOptions {
	/** How many `calls` hops from the target to follow before stopping. Clamped to at least 0. Defaults to `DEFAULT_SEQUENCE_MAX_DEPTH`. */
	maxDepth?: number;
	/** Caps the total number of steps in the diagram. Clamped to at least 0. Defaults to `DEFAULT_SEQUENCE_MAX_STEPS`. */
	maxSteps?: number;
}

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

function findContainerNode(store: ProjectGraphStore, nodeId: string): StoredNode | undefined {
	const edge = store.listEdges({ kind: 'contains', target: nodeId })[0];
	return edge ? store.getNode(edge.source) : undefined;
}

function lifelineForNode(store: ProjectGraphStore, node: StoredNode): SequenceLifeline {
	const container = findContainerNode(store, node.id);
	if (container && container.kind === 'class') {
		const lifeline: SequenceLifeline = { id: container.id, label: container.name, kind: 'class' };
		if (container.filePath) {
			lifeline.filePath = container.filePath;
		}
		if (container.range) {
			lifeline.range = container.range;
		}
		return lifeline;
	}

	if (node.kind === 'file') {
		const lifeline: SequenceLifeline = { id: node.id, label: node.name, kind: 'file' };
		if (node.filePath) {
			lifeline.filePath = node.filePath;
		}
		if (node.range) {
			lifeline.range = node.range;
		}
		return lifeline;
	}

	if (node.filePath) {
		const id = fileNodeId(node.filePath);
		const fileNode = store.getNode(id);
		const lifeline: SequenceLifeline = { id, label: path.basename(node.filePath), kind: 'file', filePath: node.filePath };
		if (fileNode?.range) {
			lifeline.range = fileNode.range;
		}
		return lifeline;
	}

	return { id: node.id, label: node.name, kind: node.kind === 'class' ? 'class' : 'file' };
}

function callOrderKey(edge: StoredEdge): number {
	const order = edge.metadata?.order;
	if (typeof order === 'number') {
		return order;
	}
	const line = edge.metadata?.line;
	return typeof line === 'number' ? line : 0;
}

function callLine(edge: StoredEdge): number | undefined {
	const line = edge.metadata?.line;
	return typeof line === 'number' ? line : undefined;
}

/**
 * Top-level function nodes declared directly in `fileNode`, in declaration
 * order — the roots of a file target's call trace. Methods nested inside a
 * class aren't included: without an actual call reaching them (e.g. a
 * top-level function invoking one), there is no real starting point in the
 * file's own top-level code to trace from.
 */
function fileTraceRoots(store: ProjectGraphStore, fileNode: StoredNode): StoredNode[] {
	return store
		.listEdges({ kind: 'contains', source: fileNode.id })
		.map((edge) => store.getNode(edge.target))
		.filter((node): node is StoredNode => node !== undefined && (node.kind === 'function' || node.kind === 'method'))
		.sort((a, b) => (a.range?.startLine ?? 0) - (b.range?.startLine ?? 0));
}

/**
 * Builds `nodeId`'s call chain for the "Show Sequence Diagram" action: only
 * meaningful for `function` and `file` nodes, matching that action's own
 * scope (../ui/sequenceDiagram); returns `undefined` for any other kind or an
 * id no longer in the Project Graph.
 */
export function buildSequenceContext(store: ProjectGraphStore, nodeId: string, options: SequenceContextOptions = {}): SequenceContext | undefined {
	const target = store.getNode(nodeId);
	if (!target || (target.kind !== 'function' && target.kind !== 'file')) {
		return undefined;
	}

	const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? DEFAULT_SEQUENCE_MAX_DEPTH));
	const maxSteps = Math.max(0, Math.floor(options.maxSteps ?? DEFAULT_SEQUENCE_MAX_STEPS));

	const participantsById = new Map<string, SequenceParticipant>();
	const lifelinesById = new Map<string, SequenceLifeline>();
	const steps: SequenceStep[] = [];
	let truncated = false;

	const registerParticipant = (node: StoredNode): SequenceParticipant => {
		const existing = participantsById.get(node.id);
		if (existing) {
			return existing;
		}
		const lifeline = lifelineForNode(store, node);
		if (!lifelinesById.has(lifeline.id)) {
			lifelinesById.set(lifeline.id, lifeline);
		}
		const participant: SequenceParticipant = { id: node.id, name: node.name, kind: node.kind, lifelineId: lifeline.id };
		if (node.filePath) {
			participant.filePath = node.filePath;
		}
		participantsById.set(node.id, participant);
		return participant;
	};

	const targetParticipant = registerParticipant(target);

	const addStep = (fromId: string, edge: StoredEdge, toNode: StoredNode): boolean => {
		if (steps.length >= maxSteps) {
			truncated = true;
			return false;
		}
		registerParticipant(toNode);
		const step: SequenceStep = {
			id: edge.id,
			order: steps.length,
			fromParticipantId: fromId,
			toParticipantId: toNode.id,
			action: `calls ${toNode.name}`
		};
		const line = callLine(edge);
		if (line !== undefined) {
			step.line = line;
		}
		steps.push(step);
		return true;
	};

	const roots = target.kind === 'file' ? fileTraceRoots(store, target) : [target];
	for (const root of roots) {
		registerParticipant(root);
	}

	const visited = new Set<string>(roots.map((node) => node.id));

	const traverse = (node: StoredNode, depth: number): void => {
		const outgoing = store
			.listEdges({ kind: 'calls', source: node.id })
			.slice()
			.sort((a, b) => callOrderKey(a) - callOrderKey(b));

		if (depth >= maxDepth) {
			if (outgoing.some((edge) => store.getNode(edge.target) !== undefined)) {
				truncated = true;
			}
			return;
		}

		for (const edge of outgoing) {
			const callee = store.getNode(edge.target);
			if (!callee) {
				continue;
			}
			const alreadyVisited = visited.has(edge.target);
			if (!addStep(node.id, edge, callee)) {
				return;
			}
			if (!alreadyVisited) {
				visited.add(edge.target);
				traverse(callee, depth + 1);
			}
		}
	};

	for (const root of roots) {
		traverse(root, 0);
	}

	return {
		target: targetParticipant,
		participants: [...participantsById.values()],
		lifelines: [...lifelinesById.values()],
		steps,
		truncated
	};
}
