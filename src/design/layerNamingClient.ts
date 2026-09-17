// Claude integration for the architecture view's per-layer/module labels: a
// short display name and one-sentence description for each folder-derived
// group ../ui/architectureLayers builds, batched into a single Claude call
// (tool use, like ./claudeClient) rather than one call per group. Takes a
// narrow `LayerNamingTarget` list instead of importing
// `../core/moduleAggregation`'s `DiagramModel` directly, keeping this
// design-layer module free of any dependency on the core layer, like
// ./sequenceDiagramClient.
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_CLAUDE_MODEL } from './claudeClient';

const MAX_OUTPUT_TOKENS = 2048;

const NAME_LAYERS_TOOL_NAME = 'name_layers';

export interface LayerNamingTarget {
	groupId: string;
	/** The group's folder name, offered to Claude as a hint and used verbatim as the fallback label when Claude is unavailable or omits this group. */
	folderLabel: string;
	fileNames: string[];
	symbolCount: number;
}

export interface LayerNamingResult {
	groupId: string;
	label: string;
	description: string;
}

/**
 * What the architecture view (../ui/architectureLayers) needs from Claude,
 * narrowed to an interface — separate from the concrete
 * `AnthropicClaudeLayerNamingClient` — so tests can supply a fake response
 * instead of making a real network call.
 */
export interface ClaudeLayerNamingClient {
	nameLayers(targets: LayerNamingTarget[]): Promise<LayerNamingResult[]>;
}

export class AnthropicClaudeLayerNamingClient implements ClaudeLayerNamingClient {
	private readonly client: Anthropic;

	constructor(apiKey: string, private readonly model: string = DEFAULT_CLAUDE_MODEL) {
		this.client = new Anthropic({ apiKey });
	}

	async nameLayers(targets: LayerNamingTarget[]): Promise<LayerNamingResult[]> {
		if (targets.length === 0) {
			return [];
		}

		const message = await this.client.messages.create({
			model: this.model,
			max_tokens: MAX_OUTPUT_TOKENS,
			system: SYSTEM_PROMPT,
			tools: [buildNameLayersTool()],
			tool_choice: { type: 'tool', name: NAME_LAYERS_TOOL_NAME },
			messages: [{ role: 'user', content: buildUserPrompt(targets) }]
		});

		const toolUse = message.content.find(
			(block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === NAME_LAYERS_TOOL_NAME
		);
		if (!toolUse) {
			throw new Error('Claude did not call the name_layers tool.');
		}

		return parseLayerNamingResults(toolUse.input, new Set(targets.map((target) => target.groupId)));
	}
}

const SYSTEM_PROMPT = `You are helping a developer understand a codebase's architecture by naming its layers/modules, each derived from a folder of source files.

For each group given, call the name_layers tool exactly once with, for every group id, a short display name (a few words, e.g. "API Routes" or "Data Access") and a one-sentence description of that group's responsibility, inferred from its file names. Never invent behavior you can't infer from the given names — if a group's purpose is unclear, give it a plain, honest description rather than guessing specifics. Include an entry for every group id given, in any order.`;

function buildUserPrompt(targets: LayerNamingTarget[]): string {
	const lines: string[] = ['Groups:'];
	for (const target of targets) {
		lines.push(
			`- id: ${target.groupId}, folder: ${target.folderLabel}, ${target.symbolCount} symbol(s), files: ${target.fileNames.join(', ')}`
		);
	}
	return lines.join('\n');
}

function buildNameLayersTool(): Anthropic.Tool {
	return {
		name: NAME_LAYERS_TOOL_NAME,
		description: 'Records a short display name and one-sentence description for each given architecture layer/module group.',
		strict: true,
		input_schema: {
			type: 'object',
			properties: {
				layers: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							groupId: { type: 'string', description: 'The group id this entry names, copied from the input.' },
							label: { type: 'string', description: 'Short display name, e.g. "API Routes".' },
							description: { type: 'string', description: "One-sentence description of this group's responsibility." }
						},
						required: ['groupId', 'label', 'description'],
						additionalProperties: false
					}
				}
			},
			required: ['layers'],
			additionalProperties: false
		}
	};
}

/**
 * Validates the tool call's `input` at runtime, like `parseProposedArchitecture`
 * (./claudeClient) and `parseSequenceDiagram` (./sequenceDiagramClient).
 * Silently drops an entry naming a group id outside `knownGroupIds` (Claude
 * inventing one) or missing a required field, rather than failing the whole
 * batch over one bad entry — the caller falls back to the folder name for
 * whichever group ids end up with no valid entry.
 */
export function parseLayerNamingResults(input: unknown, knownGroupIds: ReadonlySet<string>): LayerNamingResult[] {
	if (typeof input !== 'object' || input === null) {
		throw new Error('Claude\'s name_layers call was missing its input.');
	}

	const { layers } = input as Record<string, unknown>;
	if (!Array.isArray(layers)) {
		throw new Error('Claude\'s name_layers call must include a "layers" array.');
	}

	const results: LayerNamingResult[] = [];
	for (const entry of layers) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}
		const { groupId, label, description } = entry as Record<string, unknown>;
		if (
			typeof groupId !== 'string' ||
			!knownGroupIds.has(groupId) ||
			typeof label !== 'string' ||
			label.trim().length === 0 ||
			typeof description !== 'string' ||
			description.trim().length === 0
		) {
			continue;
		}
		results.push({ groupId, label, description });
	}
	return results;
}
