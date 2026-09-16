// Pure geometry behind the sequence diagram view's lifelines-and-messages
// rendering (./webview/SequenceDiagramApp.tsx): given an ordered list of
// lifeline ids and the steps connecting them, computes each lifeline's x
// position/total height and, per step, the vertical offset of its two
// endpoint handles — one per lifeline column, since a React Flow node can
// carry any number of named handles positioned anywhere along its own
// height. Kept free of React/React Flow, like ./graphLayout and
// ./diagramLayout, so it can be unit tested directly.
export interface SequenceDiagramLayoutStep {
	id: string;
	order: number;
	sourceLifelineId: string;
	targetLifelineId: string;
}

export interface SequenceDiagramLayoutOptions {
	lifelineSpacing?: number;
	headerHeight?: number;
	stepHeight?: number;
}

const DEFAULT_LIFELINE_SPACING = 220;
const DEFAULT_HEADER_HEIGHT = 56;
const DEFAULT_STEP_HEIGHT = 56;
/** How far below a self-message's source handle its target handle sits, small enough to stay clear of the next step's row. */
const SELF_MESSAGE_HANDLE_GAP = 20;

export type SequenceHandleSide = 'left' | 'right';

export interface SequenceHandleLayout {
	id: string;
	top: number;
	side: SequenceHandleSide;
}

export interface SequenceLifelineLayout {
	id: string;
	x: number;
	totalHeight: number;
	sourceHandles: SequenceHandleLayout[];
	targetHandles: SequenceHandleLayout[];
}

export interface SequenceStepLayout {
	id: string;
	sourceLifelineId: string;
	targetLifelineId: string;
	sourceHandleId: string;
	targetHandleId: string;
	isSelfMessage: boolean;
}

export interface SequenceDiagramLayout {
	lifelinesById: Map<string, SequenceLifelineLayout>;
	steps: SequenceStepLayout[];
	width: number;
	height: number;
}

export function sourceHandleId(stepId: string): string {
	return `${stepId}:source`;
}

export function targetHandleId(stepId: string): string {
	return `${stepId}:target`;
}

/**
 * Lays out `lifelineIds` left to right in the given order and every `step`
 * between them, one row per `step.order` (0-indexed, contiguous — matching
 * how ../core/sequenceContext numbers steps). A step's handles sit on
 * whichever side of each lifeline faces the other one, so a "backward" call
 * (target lifeline to the left of the source) draws a clean line instead of
 * curving around both cards; a self-message (same source and target
 * lifeline) uses the right side for both, with its target handle offset
 * slightly below its source handle so the edge visibly loops instead of
 * collapsing to nothing.
 */
export function computeSequenceDiagramLayout(
	lifelineIds: readonly string[],
	steps: readonly SequenceDiagramLayoutStep[],
	options: SequenceDiagramLayoutOptions = {}
): SequenceDiagramLayout {
	const lifelineSpacing = options.lifelineSpacing ?? DEFAULT_LIFELINE_SPACING;
	const headerHeight = options.headerHeight ?? DEFAULT_HEADER_HEIGHT;
	const stepHeight = options.stepHeight ?? DEFAULT_STEP_HEIGHT;

	const indexById = new Map(lifelineIds.map((id, index) => [id, index] as const));
	const totalHeight = headerHeight + (steps.length + 1) * stepHeight;

	const lifelinesById = new Map<string, SequenceLifelineLayout>();
	lifelineIds.forEach((id, index) => {
		lifelinesById.set(id, { id, x: index * lifelineSpacing, totalHeight, sourceHandles: [], targetHandles: [] });
	});

	const stepLayouts: SequenceStepLayout[] = [];
	for (const step of steps) {
		const source = lifelinesById.get(step.sourceLifelineId);
		const target = lifelinesById.get(step.targetLifelineId);
		const sourceIndex = indexById.get(step.sourceLifelineId);
		const targetIndex = indexById.get(step.targetLifelineId);
		if (!source || !target || sourceIndex === undefined || targetIndex === undefined) {
			continue;
		}

		const isSelfMessage = step.sourceLifelineId === step.targetLifelineId;
		const isBackward = targetIndex < sourceIndex;
		const sourceSide: SequenceHandleSide = isBackward ? 'left' : 'right';
		const targetSide: SequenceHandleSide = isSelfMessage ? 'right' : isBackward ? 'right' : 'left';

		const sourceTop = headerHeight + (step.order + 1) * stepHeight;
		const targetTop = isSelfMessage ? sourceTop + SELF_MESSAGE_HANDLE_GAP : sourceTop;

		const sourceHandle = { id: sourceHandleId(step.id), top: sourceTop, side: sourceSide };
		const targetHandle = { id: targetHandleId(step.id), top: targetTop, side: targetSide };
		source.sourceHandles.push(sourceHandle);
		target.targetHandles.push(targetHandle);

		stepLayouts.push({
			id: step.id,
			sourceLifelineId: step.sourceLifelineId,
			targetLifelineId: step.targetLifelineId,
			sourceHandleId: sourceHandle.id,
			targetHandleId: targetHandle.id,
			isSelfMessage
		});
	}

	return {
		lifelinesById,
		steps: stepLayouts,
		width: lifelineIds.length > 0 ? (lifelineIds.length - 1) * lifelineSpacing : 0,
		height: totalHeight
	};
}
