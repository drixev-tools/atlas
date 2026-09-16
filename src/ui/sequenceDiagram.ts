// "Show Sequence Diagram" orchestration: reads the target's call context from
// the Project Graph (../core/sequenceContext) and maps it into what
// ../design/sequenceDiagramClient's Claude client needs, mirroring how
// ./impact wires ../core/impact into ../design/impactClient. The dedicated
// view itself lives in ./sequenceDiagramView, kept separate like ./impactView
// is from ./impact.
import { buildSequenceContext, SequenceContext, SequenceParticipant } from '../core/sequenceContext';
import { ProjectGraphStore } from '../core/store';
import { SequenceDiagram, SequenceDiagramContextInput, SequenceDiagramParticipant, SequenceDiagramStep } from '../design/sequenceDiagramClient';

export const SHOW_SEQUENCE_DIAGRAM_COMMAND = 'agentGraph.showSequenceDiagram';

/** Reads `nodeId`'s call context from the Project Graph at `dbPath`. `undefined` when the node isn't a function/file, or is no longer in the graph. */
export async function loadSequenceContext(dbPath: string | undefined, nodeId: string): Promise<SequenceContext | undefined> {
	const store = await ProjectGraphStore.open({ filePath: dbPath });
	try {
		return buildSequenceContext(store, nodeId);
	} finally {
		store.close();
	}
}

function toParticipantInput(participant: SequenceParticipant): SequenceDiagramParticipant {
	const result: SequenceDiagramParticipant = { name: participant.name, kind: participant.kind };
	if (participant.filePath) {
		result.filePath = participant.filePath;
	}
	return result;
}

export function toSequenceDiagramContextInput(context: SequenceContext): SequenceDiagramContextInput {
	return {
		target: toParticipantInput(context.target),
		siblings: context.siblings.map(toParticipantInput),
		callers: context.callers.map(toParticipantInput),
		callees: context.callees.map(toParticipantInput)
	};
}

export interface SequenceDiagramViewState {
	status: 'ready' | 'noApiKey' | 'error';
	targetName: string;
	targetKind: string;
	filePath?: string;
	summary: string;
	steps: SequenceDiagramStep[];
}

export function buildSequenceDiagramViewState(context: SequenceContext, diagram: SequenceDiagram): SequenceDiagramViewState {
	return {
		status: 'ready',
		targetName: context.target.name,
		targetKind: context.target.kind,
		filePath: context.target.filePath,
		summary: diagram.summary,
		steps: diagram.steps
	};
}

/** State shown when no Anthropic API key is configured — there is no non-AI fallback for a sequence diagram, so this directs the user to the AI Settings sidebar view (../ui/settingsView) instead. */
export function buildNoApiKeySequenceDiagramViewState(context: SequenceContext): SequenceDiagramViewState {
	return {
		status: 'noApiKey',
		targetName: context.target.name,
		targetKind: context.target.kind,
		filePath: context.target.filePath,
		summary: 'Configure an Anthropic API key in the AI Settings sidebar view to generate a sequence diagram for this node.',
		steps: []
	};
}

export function buildErrorSequenceDiagramViewState(context: SequenceContext, message: string): SequenceDiagramViewState {
	return {
		status: 'error',
		targetName: context.target.name,
		targetKind: context.target.kind,
		filePath: context.target.filePath,
		summary: message,
		steps: []
	};
}
