// Claude integration for the AI-generated sequence diagram: turns the call
// context ../core/sequenceContext computed from the Project Graph (via
// ../ui/sequenceDiagram) into an ordered sequence of steps, using tool use
// like ./claudeClient does for a proposed architecture — a structured result
// is easier to render than free-form prose. Takes a narrow
// `SequenceDiagramContextInput` instead of importing ../core/sequenceContext's
// `SequenceContext` directly, keeping this design-layer module free of any
// dependency on the core layer, like ./impactClient.
import Anthropic from '@anthropic-ai/sdk';
import { NodeKind } from '../pipelines/model';
import { DEFAULT_CLAUDE_MODEL } from './claudeClient';

const MAX_OUTPUT_TOKENS = 1024;

const RECORD_SEQUENCE_DIAGRAM_TOOL_NAME = 'record_sequence_diagram';

export interface SequenceDiagramParticipant {
	name: string;
	kind: NodeKind;
	filePath?: string;
}

export interface SequenceDiagramContextInput {
	target: SequenceDiagramParticipant;
	siblings: SequenceDiagramParticipant[];
	callers: SequenceDiagramParticipant[];
	callees: SequenceDiagramParticipant[];
}

export interface SequenceDiagramStep {
	from: string;
	to: string;
	action: string;
}

export interface SequenceDiagram {
	summary: string;
	steps: SequenceDiagramStep[];
}

/**
 * What the Sequence Diagram view (../ui/sequenceDiagramView) needs from
 * Claude, narrowed to an interface — separate from the concrete
 * `AnthropicClaudeSequenceDiagramClient` — so tests can supply a fake
 * response instead of making a real network call, matching
 * `ClaudeImpactClient` (./impactClient).
 */
export interface ClaudeSequenceDiagramClient {
	generateSequenceDiagram(context: SequenceDiagramContextInput): Promise<SequenceDiagram>;
}

export class AnthropicClaudeSequenceDiagramClient implements ClaudeSequenceDiagramClient {
	private readonly client: Anthropic;

	constructor(apiKey: string, private readonly model: string = DEFAULT_CLAUDE_MODEL) {
		this.client = new Anthropic({ apiKey });
	}

	async generateSequenceDiagram(context: SequenceDiagramContextInput): Promise<SequenceDiagram> {
		const message = await this.client.messages.create({
			model: this.model,
			max_tokens: MAX_OUTPUT_TOKENS,
			system: SYSTEM_PROMPT,
			tools: [buildRecordSequenceDiagramTool()],
			tool_choice: { type: 'tool', name: RECORD_SEQUENCE_DIAGRAM_TOOL_NAME },
			messages: [{ role: 'user', content: buildUserPrompt(context) }]
		});

		const toolUse = message.content.find(
			(block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === RECORD_SEQUENCE_DIAGRAM_TOOL_NAME
		);
		if (!toolUse) {
			throw new Error('Claude did not call the record_sequence_diagram tool.');
		}

		return parseSequenceDiagram(toolUse.input);
	}
}

const SYSTEM_PROMPT = `You are helping a developer understand how a specific function or file fits into a codebase's flow, by sketching a plausible sequence diagram for it.

You will be given the target function or file, other symbols declared in the same file, and its structural neighbors: files that import its file (likely callers) and files its file imports (likely callees). This is derived from import relationships, not a confirmed call graph — treat it as context to reason from, not as ground truth about which functions call which, and say so briefly in the summary if the flow is speculative. Stay grounded in the given names; never invent unrelated services, databases, or external systems.

Call the record_sequence_diagram tool exactly once with a one-to-two sentence summary of the target's likely role in the flow, and an ordered list of 3-8 steps that best explain it (not an exhaustive trace). Each step is a "from" participant calling or returning to a "to" participant with a short "action" description. Use short, recognizable participant names and keep the same name for the same participant across steps.`;

function buildUserPrompt(context: SequenceDiagramContextInput): string {
	const lines: string[] = [`Target ${context.target.kind}: ${context.target.name}${context.target.filePath ? ` (${context.target.filePath})` : ''}`];

	if (context.siblings.length > 0) {
		lines.push('', 'Other symbols declared in the same file:', ...context.siblings.map((p) => `- ${p.name} (${p.kind})`));
	}
	if (context.callers.length > 0) {
		lines.push('', 'Files that import the target\'s file (likely callers):', ...context.callers.map((p) => `- ${p.name}`));
	}
	if (context.callees.length > 0) {
		lines.push('', 'Files the target\'s file imports (likely callees):', ...context.callees.map((p) => `- ${p.name}`));
	}
	return lines.join('\n');
}

function buildRecordSequenceDiagramTool(): Anthropic.Tool {
	return {
		name: RECORD_SEQUENCE_DIAGRAM_TOOL_NAME,
		description: 'Records a sequence diagram sketch for a function or file as a summary plus an ordered list of from/to/action steps.',
		strict: true,
		input_schema: {
			type: 'object',
			properties: {
				summary: { type: 'string', description: "One-to-two sentence summary of the target's likely role in the flow." },
				steps: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							from: { type: 'string', description: 'Participant initiating this step.' },
							to: { type: 'string', description: 'Participant receiving this step.' },
							action: { type: 'string', description: 'Short description of what happens, e.g. a call or a return.' }
						},
						required: ['from', 'to', 'action']
					}
				}
			},
			required: ['summary', 'steps']
		}
	};
}

/**
 * Validates the tool call's `input` at runtime — it is `unknown` even with
 * `strict: true` on the tool, since that guarantees schema conformance on
 * Anthropic's side but says nothing about what actually crosses the wire —
 * before `../ui/sequenceDiagram` hands it to the view. Exported so this
 * hand-written validation can be unit tested directly, without mocking the
 * Anthropic API, matching `parseProposedArchitecture` (./claudeClient).
 */
export function parseSequenceDiagram(input: unknown): SequenceDiagram {
	if (typeof input !== 'object' || input === null) {
		throw new Error('Claude\'s record_sequence_diagram call was missing its input.');
	}

	const { summary, steps } = input as Record<string, unknown>;
	if (typeof summary !== 'string' || summary.trim().length === 0) {
		throw new Error('Claude\'s record_sequence_diagram call must include a non-empty "summary" string.');
	}
	if (!Array.isArray(steps)) {
		throw new Error('Claude\'s record_sequence_diagram call must include a "steps" array.');
	}

	return { summary, steps: steps.map((step, index) => parseSequenceDiagramStep(step, index)) };
}

function parseSequenceDiagramStep(value: unknown, index: number): SequenceDiagramStep {
	if (typeof value !== 'object' || value === null) {
		throw new Error(`Claude's record_sequence_diagram call: "steps[${index}]" must be an object.`);
	}
	const step = value as Record<string, unknown>;
	return {
		from: requireString(step.from, `steps[${index}].from`),
		to: requireString(step.to, `steps[${index}].to`),
		action: requireString(step.action, `steps[${index}].action`)
	};
}

function requireString(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Claude's record_sequence_diagram call: "${path}" must be a non-empty string.`);
	}
	return value;
}
