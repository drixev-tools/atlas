// Call context for the "Show Sequence Diagram" action: a target function's
// call chain, built strictly from `calls` edges (Epic K/L's
// type-checker/ast-resolved call graph) instead of the import-based
// approximation this replaces. Participants are grouped into lifelines by
// class (when a method/function belongs to one), by file (for a file node
// itself), or otherwise get their own lifeline — so two standalone functions
// in the same file are distinct actors, not a single self-messaging one —
// and steps are the target's own outgoing `calls` edges, ordered the way they
// actually happen in source code (`metadata.order`), depth-limited and
// cycle-safe like ../ui/activeFileFlow's traversal.
//
// `buildActiveFileSequenceContext` prepends the active file's own import
// ancestry (../core/activeFileFlow, walking every chain of importers back to
// a root) ahead of a chosen function's call chain, so the full diagram reads
// oldest ancestor -> ... -> the file that imports it -> the active file ->
// the chosen function -> whatever it calls.
import { NodeKind, SourceRange } from '../pipelines/model';
import { buildActiveFileFlow } from './activeFileFlow';
import { ProjectGraphStore, StoredEdge, StoredNode } from './store';

export const DEFAULT_SEQUENCE_MAX_DEPTH = 4;
export const DEFAULT_SEQUENCE_MAX_STEPS = 12;
export const DEFAULT_SEQUENCE_MAX_ANCESTOR_STEPS = 12;

export type SequenceLifelineKind = 'file' | 'class' | 'function';

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

export type SequenceStepKind = 'calls' | 'imports' | 'declares';

export interface SequenceStep {
	id: string;
	order: number;
	fromParticipantId: string;
	toParticipantId: string;
	/** Default, non-AI label for this step, e.g. "calls foo" — what the view shows before/without a Claude-generated one. */
	action: string;
	/** What kind of relationship this step represents — a real function call, a file importing another, or a file declaring the function the diagram continues from. Defaults to `'calls'` when absent. */
	kind?: SequenceStepKind;
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
	/** Caps the number of ancestor-import steps `buildActiveFileSequenceContext` includes before the active file. Clamped to at least 0. Defaults to `DEFAULT_SEQUENCE_MAX_ANCESTOR_STEPS`. */
	maxAncestorSteps?: number;
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

	const lifeline: SequenceLifeline = { id: node.id, label: node.name, kind: 'function' };
	if (node.filePath) {
		lifeline.filePath = node.filePath;
	}
	if (node.range) {
		lifeline.range = node.range;
	}
	return lifeline;
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

/** Shared participant/lifeline bookkeeping for both `buildSequenceContext` and `buildActiveFileSequenceContext`, so a node already registered by one segment (e.g. the active file, seen in both the ancestor chain and the file-to-function step) reuses the same participant instead of duplicating it. */
function createParticipantRegistry(store: ProjectGraphStore): {
	participantsById: Map<string, SequenceParticipant>;
	lifelinesById: Map<string, SequenceLifeline>;
	registerParticipant: (node: StoredNode) => SequenceParticipant;
} {
	const participantsById = new Map<string, SequenceParticipant>();
	const lifelinesById = new Map<string, SequenceLifeline>();

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

	return { participantsById, lifelinesById, registerParticipant };
}

/**
 * Builds `nodeId`'s call chain for the "Show Sequence Diagram" action: only
 * meaningful for `function`, `method` and `file` nodes, matching that
 * action's own scope (../ui/sequenceDiagram); returns `undefined` for any
 * other kind or an id no longer in the Project Graph.
 */
export function buildSequenceContext(store: ProjectGraphStore, nodeId: string, options: SequenceContextOptions = {}): SequenceContext | undefined {
	const target = store.getNode(nodeId);
	if (!target || (target.kind !== 'function' && target.kind !== 'method' && target.kind !== 'file')) {
		return undefined;
	}

	const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? DEFAULT_SEQUENCE_MAX_DEPTH));
	const maxSteps = Math.max(0, Math.floor(options.maxSteps ?? DEFAULT_SEQUENCE_MAX_STEPS));

	const { participantsById, lifelinesById, registerParticipant } = createParticipantRegistry(store);
	const steps: SequenceStep[] = [];
	let truncated = false;

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
			action: `calls ${toNode.name}`,
			kind: 'calls'
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

export interface SequenceFunctionCandidate {
	id: string;
	name: string;
	/** The class this function is a method of, when it's not a standalone function. */
	containerName?: string;
	line?: number;
}

/**
 * Every function/method declared in `fileId` (top-level or nested one class
 * deep, matching how ../ui/sequenceDiagramLayout/./sequenceContext already
 * group participants), in declaration order — what the "Show Sequence
 * Diagram" Quick Pick offers so the user can choose which one to trace,
 * since a file usually has more than one.
 */
export function listSequenceFunctionCandidates(store: ProjectGraphStore, fileId: string): SequenceFunctionCandidate[] {
	const candidates: SequenceFunctionCandidate[] = [];

	const visit = (containerId: string, containerName: string | undefined): void => {
		for (const edge of store.listEdges({ kind: 'contains', source: containerId })) {
			const child = store.getNode(edge.target);
			if (!child) {
				continue;
			}
			if (child.kind === 'function' || child.kind === 'method') {
				const candidate: SequenceFunctionCandidate = { id: child.id, name: child.name };
				if (containerName) {
					candidate.containerName = containerName;
				}
				if (child.range?.startLine !== undefined) {
					candidate.line = child.range.startLine;
				}
				candidates.push(candidate);
			} else if (child.kind === 'class') {
				visit(child.id, child.name);
			}
		}
	};

	visit(fileId, undefined);
	return candidates.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/**
 * Builds the combined "how the app gets here, and what happens next" diagram
 * for `functionId`, a function declared in `activeFileId`: every chain of
 * files that (transitively) imports `activeFileId` (../core/activeFileFlow,
 * oldest ancestor first), a step from the active file to `functionId` itself,
 * then `functionId`'s own outgoing call chain (`buildSequenceContext`,
 * unchanged). Returns `undefined` when `activeFileId` isn't a file node or
 * `functionId` isn't a function/method node in the Project Graph.
 */
export function buildActiveFileSequenceContext(
	store: ProjectGraphStore,
	activeFileId: string,
	functionId: string,
	options: SequenceContextOptions = {}
): SequenceContext | undefined {
	const activeFileNode = store.getNode(activeFileId);
	if (!activeFileNode || activeFileNode.kind !== 'file') {
		return undefined;
	}
	const functionNode = store.getNode(functionId);
	if (!functionNode || (functionNode.kind !== 'function' && functionNode.kind !== 'method')) {
		return undefined;
	}

	const maxAncestorSteps = Math.max(0, Math.floor(options.maxAncestorSteps ?? DEFAULT_SEQUENCE_MAX_ANCESTOR_STEPS));
	const { participantsById, lifelinesById, registerParticipant } = createParticipantRegistry(store);
	const steps: SequenceStep[] = [];
	let truncated = false;

	const graph = store.getGraph();
	const flow = buildActiveFileFlow(graph, activeFileId);
	if (flow) {
		const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
		const ancestorEdges = flow.edges.filter((edge) => flow.highlightedIds.has(edge.source) && flow.highlightedIds.has(edge.target));

		const levelById = new Map<string, number>([...flow.rootIds].map((id) => [id, 0]));
		const edgesBySource = new Map<string, StoredEdge[]>();
		for (const edge of ancestorEdges) {
			const existing = edgesBySource.get(edge.source);
			if (existing) {
				existing.push(edge);
			} else {
				edgesBySource.set(edge.source, [edge]);
			}
		}
		let frontier = [...flow.rootIds];
		while (frontier.length > 0) {
			const next: string[] = [];
			for (const id of frontier) {
				const level = levelById.get(id) ?? 0;
				for (const edge of edgesBySource.get(id) ?? []) {
					if (!levelById.has(edge.target)) {
						levelById.set(edge.target, level + 1);
						next.push(edge.target);
					}
				}
			}
			frontier = next;
		}

		const orderedAncestorEdges = ancestorEdges.slice().sort((a, b) => {
			const levelDiff = (levelById.get(a.source) ?? 0) - (levelById.get(b.source) ?? 0);
			if (levelDiff !== 0) {
				return levelDiff;
			}
			const sourceNameDiff = (nodeById.get(a.source)?.name ?? '').localeCompare(nodeById.get(b.source)?.name ?? '');
			if (sourceNameDiff !== 0) {
				return sourceNameDiff;
			}
			return (nodeById.get(a.target)?.name ?? '').localeCompare(nodeById.get(b.target)?.name ?? '');
		});

		for (const edge of orderedAncestorEdges) {
			if (steps.length >= maxAncestorSteps) {
				truncated = true;
				break;
			}
			const sourceNode = nodeById.get(edge.source);
			const targetNode = nodeById.get(edge.target);
			if (!sourceNode || !targetNode) {
				continue;
			}
			const sourceParticipant = registerParticipant(sourceNode);
			const targetParticipant = registerParticipant(targetNode);
			steps.push({
				id: edge.id,
				order: steps.length,
				fromParticipantId: sourceParticipant.id,
				toParticipantId: targetParticipant.id,
				action: `imports ${targetNode.name}`,
				kind: 'imports'
			});
		}
	}

	const activeFileParticipant = registerParticipant(activeFileNode);
	const functionParticipant = registerParticipant(functionNode);
	steps.push({
		id: `declares:${activeFileId}:${functionId}`,
		order: steps.length,
		fromParticipantId: activeFileParticipant.id,
		toParticipantId: functionParticipant.id,
		action: `declares ${functionNode.name}`,
		kind: 'declares'
	});

	const forward = buildSequenceContext(store, functionId, options);
	if (!forward) {
		return {
			target: functionParticipant,
			participants: [...participantsById.values()],
			lifelines: [...lifelinesById.values()],
			steps,
			truncated
		};
	}

	const order = steps.length;
	for (const participant of forward.participants) {
		if (!participantsById.has(participant.id)) {
			participantsById.set(participant.id, participant);
		}
	}
	for (const lifeline of forward.lifelines) {
		if (!lifelinesById.has(lifeline.id)) {
			lifelinesById.set(lifeline.id, lifeline);
		}
	}
	for (const step of forward.steps) {
		steps.push({ ...step, order: step.order + order });
	}

	return {
		target: forward.target,
		participants: [...participantsById.values()],
		lifelines: [...lifelinesById.values()],
		steps,
		truncated: truncated || forward.truncated
	};
}
