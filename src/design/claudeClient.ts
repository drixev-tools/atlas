// Claude integration: turns a `ProjectIntent` into a `ProposedArchitecture`
// via the Anthropic Messages API's tool use, forcing
// the model to call a single `propose_architecture` tool instead of
// free-form prose so the response is structured data ./proposedGraph can
// convert directly into the Project Graph's node/edge model.
import Anthropic, { AuthenticationError } from '@anthropic-ai/sdk';
import { EDGE_KINDS, NODE_KINDS } from '../pipelines/model';
import { ProjectIntent, ProposedArchitecture, ProposedEdge, ProposedNode } from './model';

export { AuthenticationError };

/**
 * The model id the system this extension runs under reports as its own
 * (`claude-sonnet-5`), confirmed against `@anthropic-ai/sdk`'s own `Model`
 * type union — i.e. a real, currently available model, not a guess. Used as
 * the fallback when no model has been configured yet; the choice itself is
 * configurable via the Settings sidebar view and `../design/settings`'
 * `ClaudeSettingsStore`, of which this is one of the options
 * (`CLAUDE_MODEL_OPTIONS`).
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

const MAX_OUTPUT_TOKENS = 8192;

const PROPOSE_ARCHITECTURE_TOOL_NAME = 'propose_architecture';

/**
 * What `designProject` (../ui/designProject) needs from Claude, narrowed to
 * an interface — separate from the concrete `AnthropicClaudeDesignClient` —
 * so tests can supply a fake response instead of making a real network call,
 * matching `GitStatusSource` (../core/gitStatus) and `ApiKeyStore` (./apiKey).
 */
export interface ClaudeDesignClient {
	proposeArchitecture(intent: ProjectIntent): Promise<ProposedArchitecture>;
}

export class AnthropicClaudeDesignClient implements ClaudeDesignClient {
	private readonly client: Anthropic;

	constructor(apiKey: string, private readonly model: string = DEFAULT_CLAUDE_MODEL) {
		this.client = new Anthropic({ apiKey });
	}

	async proposeArchitecture(intent: ProjectIntent): Promise<ProposedArchitecture> {
		const message = await this.client.messages.create({
			model: this.model,
			max_tokens: MAX_OUTPUT_TOKENS,
			system: SYSTEM_PROMPT,
			tools: [buildProposeArchitectureTool()],
			tool_choice: { type: 'tool', name: PROPOSE_ARCHITECTURE_TOOL_NAME },
			messages: [{ role: 'user', content: buildUserPrompt(intent) }]
		});

		const toolUse = message.content.find(
			(block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === PROPOSE_ARCHITECTURE_TOOL_NAME
		);
		if (!toolUse) {
			throw new Error('Claude did not call the propose_architecture tool.');
		}

		return parseProposedArchitecture(toolUse.input);
	}
}

const SYSTEM_PROMPT = `You are a software architect helping a developer design a new project or feature before any code is written.

Given the developer's intent, call the propose_architecture tool exactly once with a proposed architecture: the files, modules, classes, functions, and other components involved, and how they relate to each other.

Guidelines:
- Keep the graph legible: cover the architecturally significant pieces (files, key modules/classes/functions and how they depend on each other), not every trivial helper.
- Use "contains" edges for a file containing a class/function/etc., "imports" edges for one file/module depending on another, and "exports" edges for a file exposing a symbol.
- Every file-kind node needs a workspace-relative filePath (e.g. "src/auth/loginService.ts"); give other nodes a filePath too when they belong to a specific file.
- Give each node a short, unique "ref" used only to connect edges below — it is never shown to the user.`;

function buildUserPrompt(intent: ProjectIntent): string {
	const lines = [
		`Project/feature name: ${intent.name}`,
		`Primary stack: ${intent.stack}`,
		intent.keyComponents.length > 0 ? `Key components already in mind: ${intent.keyComponents.join(', ')}` : undefined,
		'',
		'Description:',
		intent.description
	];
	return lines.filter((line) => line !== undefined).join('\n');
}

function buildProposeArchitectureTool(): Anthropic.Tool {
	return {
		name: PROPOSE_ARCHITECTURE_TOOL_NAME,
		description: 'Records the proposed architecture for a new project or feature as a graph of nodes (files, modules, classes, functions, ...) and edges (contains, imports, exports) between them.',
		strict: true,
		input_schema: {
			type: 'object',
			properties: {
				nodes: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							ref: { type: 'string', description: 'Short unique key for this node, used only to wire up edges below (e.g. "authService"). Not shown to the user.' },
							kind: { type: 'string', enum: [...NODE_KINDS] },
							name: { type: 'string', description: 'Human-readable name, e.g. a file name, class name, or function name.' },
							filePath: { type: 'string', description: 'Workspace-relative file path, e.g. "src/auth/loginService.ts". Required for kind "file", and recommended for any node that lives inside a specific file.' },
							language: { type: 'string', description: 'Optional, e.g. "typescript", "python".' },
							description: { type: 'string', description: 'Optional one-sentence responsibility of this node.' }
						},
						required: ['ref', 'kind', 'name']
					}
				},
				edges: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							kind: { type: 'string', enum: [...EDGE_KINDS] },
							sourceRef: { type: 'string' },
							targetRef: { type: 'string' },
							description: { type: 'string' }
						},
						required: ['kind', 'sourceRef', 'targetRef']
					}
				}
			},
			required: ['nodes', 'edges']
		}
	};
}

/**
 * Validates the tool call's `input` at runtime — it is `unknown` even with
 * `strict: true` on the tool, since that guarantees schema conformance on
 * Anthropic's side but says nothing about what actually crosses the wire —
 * before `../ui/designProject` hands it to the (trusting) `buildProposedGraph`.
 * Exported so this hand-written validation can be unit tested directly,
 * without mocking the Anthropic API.
 */
export function parseProposedArchitecture(input: unknown): ProposedArchitecture {
	if (typeof input !== 'object' || input === null) {
		throw new Error('Claude\'s propose_architecture call was missing its input.');
	}

	const { nodes, edges } = input as Record<string, unknown>;
	if (!Array.isArray(nodes) || !Array.isArray(edges)) {
		throw new Error('Claude\'s propose_architecture call must include "nodes" and "edges" arrays.');
	}

	return {
		nodes: nodes.map((node, index) => parseProposedNode(node, index)),
		edges: edges.map((edge, index) => parseProposedEdge(edge, index))
	};
}

function parseProposedNode(value: unknown, index: number): ProposedNode {
	const node = requireObject(value, `nodes[${index}]`);
	const ref = requireString(node.ref, `nodes[${index}].ref`);
	const kind = requireEnum(node.kind, NODE_KINDS, `nodes[${index}].kind`);
	const name = requireString(node.name, `nodes[${index}].name`);

	const result: ProposedNode = { ref, kind, name };
	if (node.filePath !== undefined) {
		result.filePath = requireString(node.filePath, `nodes[${index}].filePath`);
	}
	if (node.language !== undefined) {
		result.language = requireString(node.language, `nodes[${index}].language`);
	}
	if (node.description !== undefined) {
		result.description = requireString(node.description, `nodes[${index}].description`);
	}
	return result;
}

function parseProposedEdge(value: unknown, index: number): ProposedEdge {
	const edge = requireObject(value, `edges[${index}]`);
	const kind = requireEnum(edge.kind, EDGE_KINDS, `edges[${index}].kind`);
	const sourceRef = requireString(edge.sourceRef, `edges[${index}].sourceRef`);
	const targetRef = requireString(edge.targetRef, `edges[${index}].targetRef`);

	const result: ProposedEdge = { kind, sourceRef, targetRef };
	if (edge.description !== undefined) {
		result.description = requireString(edge.description, `edges[${index}].description`);
	}
	return result;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null) {
		throw new Error(`Claude's propose_architecture call: "${path}" must be an object.`);
	}
	return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Claude's propose_architecture call: "${path}" must be a non-empty string.`);
	}
	return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
	if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
		throw new Error(`Claude's propose_architecture call: "${path}" must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}.`);
	}
	return value as T;
}
