// "Show Sequence Diagram" orchestration: reads the target's call chain from
// the Project Graph (../core/sequenceContext) and maps it into what
// ../design/sequenceDiagramClient's Claude client needs, mirroring how
// ./impact wires ../core/impact into ../design/impactClient. Unlike the
// import-based approximation this replaces, the diagram itself (lifelines,
// participants, steps and their order) is always fully derivable from the
// Project Graph — `buildFallbackSequenceDiagramViewState` needs no API key at
// all; Claude only relabels steps and writes a summary, exactly like
// `buildFallbackExplanation`/`buildImpactViewState` do for Calculate Impact.
// The dedicated view itself lives in ./sequenceDiagramView, kept separate
// like ./impactView is from ./impact.
import { NodeKind } from '../pipelines/model';
import { buildSequenceContext, SequenceContext, SequenceContextOptions, SequenceLifeline, SequenceParticipant } from '../core/sequenceContext';
import { ProjectGraphStore } from '../core/store';
import { SequenceDiagramContextInput, SequenceDiagramNarration, SequenceDiagramStepLabel } from '../design/sequenceDiagramClient';

export const SHOW_SEQUENCE_DIAGRAM_COMMAND = 'agentGraph.showSequenceDiagram';

/** Reads `nodeId`'s call chain from the Project Graph at `dbPath`. `undefined` when the node isn't a function/file, or is no longer in the graph. */
export async function loadSequenceContext(
	dbPath: string | undefined,
	nodeId: string,
	options?: SequenceContextOptions
): Promise<SequenceContext | undefined> {
	const store = await ProjectGraphStore.open({ filePath: dbPath });
	try {
		return buildSequenceContext(store, nodeId, options);
	} finally {
		store.close();
	}
}

export function toSequenceDiagramNarrationInput(context: SequenceContext): SequenceDiagramContextInput {
	const nameById = new Map(context.participants.map((participant) => [participant.id, participant.name] as const));
	return {
		target: { name: context.target.name, kind: context.target.kind },
		steps: context.steps.map((step) => ({
			order: step.order,
			from: nameById.get(step.fromParticipantId) ?? step.fromParticipantId,
			to: nameById.get(step.toParticipantId) ?? step.toParticipantId,
			defaultAction: step.action
		}))
	};
}

/** The fallback summary the persistent view (../ui/sequenceDiagramView) shows when no Anthropic API key is configured, or Claude's call failed — the diagram stays fully usable without it. */
export function buildFallbackSequenceSummary(context: SequenceContext): string {
	if (context.steps.length === 0) {
		return `No resolvable calls found for "${context.target.name}".`;
	}
	const lines = [`${context.target.name} takes part in ${context.steps.length} call(s) across ${context.lifelines.length} lifeline(s).`];
	if (context.truncated) {
		lines.push('Some calls beyond the shown depth/step limit were left out.');
	}
	return lines.join(' ');
}

export interface SequenceDiagramStepView {
	id: string;
	order: number;
	fromParticipantId: string;
	toParticipantId: string;
	label: string;
	line?: number;
}

export interface SequenceDiagramViewState {
	targetId: string;
	targetName: string;
	targetKind: NodeKind;
	targetLifelineId: string;
	filePath?: string;
	summary: string;
	aiGenerated: boolean;
	truncated: boolean;
	lifelines: SequenceLifeline[];
	participants: SequenceParticipant[];
	steps: SequenceDiagramStepView[];
}

function toStepViews(context: SequenceContext, stepLabelsByOrder: ReadonlyMap<number, string> | undefined): SequenceDiagramStepView[] {
	return context.steps.map((step) => {
		const view: SequenceDiagramStepView = {
			id: step.id,
			order: step.order,
			fromParticipantId: step.fromParticipantId,
			toParticipantId: step.toParticipantId,
			label: stepLabelsByOrder?.get(step.order) ?? step.action
		};
		if (step.line !== undefined) {
			view.line = step.line;
		}
		return view;
	});
}

/** Builds the view state for `context`, with `summary`/per-step labels from Claude when `aiGenerated`, or the non-AI defaults otherwise. */
export function buildSequenceDiagramViewState(
	context: SequenceContext,
	summary: string,
	aiGenerated: boolean,
	stepLabelsByOrder?: ReadonlyMap<number, string>
): SequenceDiagramViewState {
	return {
		targetId: context.target.id,
		targetName: context.target.name,
		targetKind: context.target.kind,
		targetLifelineId: context.target.lifelineId,
		filePath: context.target.filePath,
		summary,
		aiGenerated,
		truncated: context.truncated,
		lifelines: context.lifelines,
		participants: context.participants,
		steps: toStepViews(context, stepLabelsByOrder)
	};
}

/** `buildSequenceDiagramViewState` with the non-AI fallback summary/labels — always valid, since the diagram itself never depends on Claude. */
export function buildFallbackSequenceDiagramViewState(context: SequenceContext): SequenceDiagramViewState {
	return buildSequenceDiagramViewState(context, buildFallbackSequenceSummary(context), false);
}

/** Applies a successful Claude narration onto `context` as an AI-generated view state, ignoring any `stepLabels` entry whose order doesn't match a real step. */
export function applySequenceDiagramNarration(context: SequenceContext, narration: SequenceDiagramNarration): SequenceDiagramViewState {
	const stepLabelsByOrder = new Map<number, string>(narration.stepLabels.map((entry: SequenceDiagramStepLabel) => [entry.order, entry.label]));
	return buildSequenceDiagramViewState(context, narration.summary, true, stepLabelsByOrder);
}
