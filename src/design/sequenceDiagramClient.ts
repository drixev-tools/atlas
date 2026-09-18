// Claude integration for the sequence diagram view's narration only: the
// participants, lifelines, steps and their order are already fully
// determined by ../core/sequenceContext's real `calls`-edge chain, so Claude
// is never asked to invent structure here — only to relabel each
// already-fixed step in nicer language and write a short overall summary.
// Takes a narrow `SequenceDiagramContextInput` instead of importing
// ../core/sequenceContext's `SequenceContext` directly, keeping this
// design-layer module free of any dependency on the core layer.
import Anthropic from '@anthropic-ai/sdk';
import { NodeKind } from '../pipelines/model';
import { DEFAULT_CLAUDE_MODEL } from './settings';

const MAX_OUTPUT_TOKENS = 1024;

const RECORD_SEQUENCE_NARRATION_TOOL_NAME = 'record_sequence_narration';

export interface SequenceDiagramStepInput {
	order: number;
	from: string;
	to: string;
	/** The step's non-AI default label, e.g. "calls foo" — what Claude is expected to improve on, not replace with something unrelated. */
	defaultAction: string;
	/** What kind of relationship this step represents — a function call, a file importing another, or a file declaring the function the diagram continues from. Defaults to `'calls'` when absent. */
	kind?: 'calls' | 'imports' | 'declares';
}

export interface SequenceDiagramContextInput {
	target: { name: string; kind: NodeKind };
	steps: SequenceDiagramStepInput[];
}

export interface SequenceDiagramStepLabel {
	order: number;
	label: string;
}

export interface SequenceDiagramNarration {
	summary: string;
	stepLabels: SequenceDiagramStepLabel[];
}

/**
 * What the Sequence Diagram view (../ui/sequenceDiagramView) needs from
 * Claude, narrowed to an interface — separate from the concrete
 * `AnthropicClaudeSequenceDiagramClient` — so tests can supply a fake
 * response instead of making a real network call.
 */
export interface ClaudeSequenceDiagramClient {
	narrateSequence(context: SequenceDiagramContextInput): Promise<SequenceDiagramNarration>;
}

export class AnthropicClaudeSequenceDiagramClient implements ClaudeSequenceDiagramClient {
	private readonly client: Anthropic;

	constructor(apiKey: string, private readonly model: string = DEFAULT_CLAUDE_MODEL) {
		this.client = new Anthropic({ apiKey });
	}

	async narrateSequence(context: SequenceDiagramContextInput): Promise<SequenceDiagramNarration> {
		const message = await this.client.messages.create({
			model: this.model,
			max_tokens: MAX_OUTPUT_TOKENS,
			system: SYSTEM_PROMPT,
			tools: [buildRecordSequenceNarrationTool()],
			tool_choice: { type: 'tool', name: RECORD_SEQUENCE_NARRATION_TOOL_NAME },
			messages: [{ role: 'user', content: buildUserPrompt(context) }]
		});

		const toolUse = message.content.find(
			(block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === RECORD_SEQUENCE_NARRATION_TOOL_NAME
		);
		if (!toolUse) {
			throw new Error('Claude did not call the record_sequence_narration tool.');
		}

		return parseSequenceDiagramNarration(toolUse.input);
	}
}

const SYSTEM_PROMPT = `You are helping a developer read a sequence diagram of how a codebase reaches a specific function, and what that function does next.

The participants, steps, and their order are already fixed, extracted directly from the codebase — never add, remove, reorder, or rename them. Most steps are real function calls, but a step marked "imports" is one file importing another (part of how the app reaches the target file, not a call), and a step marked "declares" is the target file declaring the function the call chain continues from — word those two kinds accordingly instead of describing them as calls. You will be given each step's order index, kind, "from"/"to" participant names, and a generic default label (e.g. "calls foo").

Call the record_sequence_narration tool exactly once with: a one-to-two sentence overall summary of what this flow does, and for each step (referenced by its order index) a short 2-6 word label in plain language describing what that step actually does — nicer and more specific than the generic default, but never inventing behavior the default label doesn't already imply.`;

function buildUserPrompt(context: SequenceDiagramContextInput): string {
	const lines: string[] = [`Target ${context.target.kind}: ${context.target.name}`, ''];

	if (context.steps.length === 0) {
		lines.push('No steps — this target has no resolvable calls.');
	} else {
		lines.push(
			'Steps:',
			...context.steps.map((step) => `${step.order}. [${step.kind ?? 'calls'}] ${step.from} -> ${step.to} (default: "${step.defaultAction}")`)
		);
	}

	return lines.join('\n');
}

function buildRecordSequenceNarrationTool(): Anthropic.Tool {
	return {
		name: RECORD_SEQUENCE_NARRATION_TOOL_NAME,
		description: 'Records a one-to-two sentence summary and a per-step label for an already-fixed sequence diagram.',
		strict: true,
		input_schema: {
			type: 'object',
			properties: {
				summary: { type: 'string', description: "One-to-two sentence summary of the flow's overall purpose." },
				stepLabels: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							order: { type: 'integer', description: 'The order index of the step this label belongs to.' },
							label: { type: 'string', description: 'Short 2-6 word label for what this step does.' }
						},
						required: ['order', 'label'],
						additionalProperties: false
					}
				}
			},
			required: ['summary', 'stepLabels'],
			additionalProperties: false
		}
	};
}

/**
 * Validates the tool call's `input` at runtime — it is `unknown` even with
 * `strict: true` on the tool, since that guarantees schema conformance on
 * Anthropic's side but says nothing about what actually crosses the wire —
 * before `../ui/sequenceDiagram` hands it to the view. Exported so this
 * hand-written validation can be unit tested directly, without mocking the
 * Anthropic API, matching `parseArchitectureIdentification`
 * (./architectureIdentificationClient).
 */
export function parseSequenceDiagramNarration(input: unknown): SequenceDiagramNarration {
	if (typeof input !== 'object' || input === null) {
		throw new Error("Claude's record_sequence_narration call was missing its input.");
	}

	const { summary, stepLabels } = input as Record<string, unknown>;
	if (typeof summary !== 'string' || summary.trim().length === 0) {
		throw new Error('Claude\'s record_sequence_narration call must include a non-empty "summary" string.');
	}
	if (!Array.isArray(stepLabels)) {
		throw new Error('Claude\'s record_sequence_narration call must include a "stepLabels" array.');
	}

	return { summary, stepLabels: stepLabels.map((entry, index) => parseSequenceDiagramStepLabel(entry, index)) };
}

function parseSequenceDiagramStepLabel(value: unknown, index: number): SequenceDiagramStepLabel {
	if (typeof value !== 'object' || value === null) {
		throw new Error(`Claude's record_sequence_narration call: "stepLabels[${index}]" must be an object.`);
	}
	const entry = value as Record<string, unknown>;
	const { order, label } = entry;
	if (typeof order !== 'number' || !Number.isFinite(order)) {
		throw new Error(`Claude's record_sequence_narration call: "stepLabels[${index}].order" must be a number.`);
	}
	if (typeof label !== 'string' || label.trim().length === 0) {
		throw new Error(`Claude's record_sequence_narration call: "stepLabels[${index}].label" must be a non-empty string.`);
	}
	return { order, label };
}
