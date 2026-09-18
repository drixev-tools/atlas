// Claude integration for the "Identified Architecture" view: naming the
// project's real software architecture pattern (layered, hexagonal, MVC,
// ...) and assigning each already-aggregated folder module an architectural
// role, from a summary of the real Project Graph
// (../ui/identifiedArchitecture's folder groups and their relationships) —
// never the source code itself. Batched into a single Claude call (tool use,
// like ./layerNamingClient). Takes a narrow `ArchitectureIdentificationEntity`
// list instead of importing `../core/diagramModel`'s `DiagramModel` directly,
// keeping this design-layer module free of any dependency on the core layer,
// like ./layerNamingClient.
import Anthropic from '@anthropic-ai/sdk';
import { EdgeKind } from '../pipelines/model';
import { DEFAULT_CLAUDE_MODEL } from './settings';

const MAX_OUTPUT_TOKENS = 4096;

const IDENTIFY_ARCHITECTURE_TOOL_NAME = 'identify_architecture';

export interface ArchitectureIdentificationRelation {
	label: string;
	kinds: EdgeKind[];
}

export interface ArchitectureIdentificationEntity {
	groupId: string;
	/** The module's folder name, offered to Claude as a hint. */
	label: string;
	fileNames: string[];
	symbolCount: number;
	dependsOn: ArchitectureIdentificationRelation[];
	dependedOnBy: ArchitectureIdentificationRelation[];
}

export interface ArchitectureRoleDefinition {
	role: string;
	description: string;
}

export interface ArchitectureRoleAssignment {
	groupId: string;
	role: string;
}

export interface ArchitectureIdentification {
	patternName: string;
	patternDescription: string;
	roles: ArchitectureRoleDefinition[];
	assignments: ArchitectureRoleAssignment[];
}

/**
 * What the Identified Architecture view (../ui/identifiedArchitecture) needs
 * from Claude, narrowed to an interface — separate from the concrete
 * `AnthropicClaudeArchitectureIdentificationClient` — so tests can supply a
 * fake response instead of making a real network call, matching
 * `ClaudeLayerNamingClient` (./layerNamingClient).
 */
export interface ClaudeArchitectureIdentificationClient {
	identifyArchitecture(entities: ArchitectureIdentificationEntity[]): Promise<ArchitectureIdentification>;
}

export class AnthropicClaudeArchitectureIdentificationClient implements ClaudeArchitectureIdentificationClient {
	private readonly client: Anthropic;

	constructor(apiKey: string, private readonly model: string = DEFAULT_CLAUDE_MODEL) {
		this.client = new Anthropic({ apiKey });
	}

	async identifyArchitecture(entities: ArchitectureIdentificationEntity[]): Promise<ArchitectureIdentification> {
		if (entities.length === 0) {
			throw new Error('No modules to identify an architecture from.');
		}

		const message = await this.client.messages.create({
			model: this.model,
			max_tokens: MAX_OUTPUT_TOKENS,
			system: SYSTEM_PROMPT,
			tools: [buildIdentifyArchitectureTool()],
			tool_choice: { type: 'tool', name: IDENTIFY_ARCHITECTURE_TOOL_NAME },
			messages: [{ role: 'user', content: buildUserPrompt(entities) }]
		});

		const toolUse = message.content.find(
			(block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === IDENTIFY_ARCHITECTURE_TOOL_NAME
		);
		if (!toolUse) {
			throw new Error('Claude did not call the identify_architecture tool.');
		}

		return parseArchitectureIdentification(toolUse.input, new Set(entities.map((entity) => entity.groupId)));
	}
}

const SYSTEM_PROMPT = `You are a software architect reverse-engineering a codebase's real architecture from a summary of its folder-derived modules and their dependencies.

You will be given a list of modules (each a folder-derived group of the real codebase), with their file names, symbol counts, and which other modules they depend on / are depended on by (with the kind of relationship — imports, calls, extends, implements, instantiates). You are never shown the source code itself.

Call the identify_architecture tool exactly once with:
- patternName: a short name for the architecture pattern this codebase actually follows (e.g. "Layered Architecture", "Hexagonal Architecture", "MVC", "Feature-Sliced", or "No clear pattern" if none fits).
- patternDescription: one-to-two sentences explaining why, grounded in the modules and dependencies you were given.
- roles: the small set of architectural roles this pattern implies (e.g. "Controller", "Service", "Repository", "Domain Model"), each with a one-sentence description of that role's responsibility.
- assignments: for every module id given, which role (by its exact name from "roles") it plays. Every module must get exactly one role; use a catch-all role like "Other" rather than omitting a module.

Never invent behavior you can't infer from the given names and dependencies — describe honestly, including when the codebase doesn't cleanly fit a textbook pattern.`;

function buildUserPrompt(entities: ArchitectureIdentificationEntity[]): string {
	const lines: string[] = ['Modules:'];
	for (const entity of entities) {
		const relations: string[] = [];
		if (entity.dependsOn.length > 0) {
			relations.push(`depends on ${entity.dependsOn.map((relation) => `${relation.label} (${relation.kinds.join(', ')})`).join(', ')}`);
		}
		if (entity.dependedOnBy.length > 0) {
			relations.push(`depended on by ${entity.dependedOnBy.map((relation) => `${relation.label} (${relation.kinds.join(', ')})`).join(', ')}`);
		}
		lines.push(
			`- id: ${entity.groupId}, name: ${entity.label}, ${entity.symbolCount} symbol(s), files: ${entity.fileNames.join(', ')}${
				relations.length > 0 ? '; ' + relations.join('; ') : ''
			}`
		);
	}
	return lines.join('\n');
}

function buildIdentifyArchitectureTool(): Anthropic.Tool {
	return {
		name: IDENTIFY_ARCHITECTURE_TOOL_NAME,
		description: "Records the codebase's identified architecture pattern, its roles, and which role each given module plays.",
		strict: true,
		input_schema: {
			type: 'object',
			properties: {
				patternName: { type: 'string', description: 'Short name of the identified architecture pattern.' },
				patternDescription: { type: 'string', description: 'One-to-two sentence justification grounded in the given modules/dependencies.' },
				roles: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							role: { type: 'string', description: 'Short role name, e.g. "Controller".' },
							description: { type: 'string', description: "One-sentence description of this role's responsibility." }
						},
						required: ['role', 'description'],
						additionalProperties: false
					}
				},
				assignments: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							groupId: { type: 'string', description: 'The module id this assignment is for, copied from the input.' },
							role: { type: 'string', description: 'The role (by its exact name from "roles") this module plays.' }
						},
						required: ['groupId', 'role'],
						additionalProperties: false
					}
				}
			},
			required: ['patternName', 'patternDescription', 'roles', 'assignments'],
			additionalProperties: false
		}
	};
}

/**
 * Validates the tool call's `input` at runtime, like `parseLayerNamingResults`
 * (./layerNamingClient) and `parseSequenceDiagramNarration`
 * (./sequenceDiagramClient). Drops an assignment naming a group id outside
 * `knownGroupIds` (Claude inventing one) or a role missing from its own
 * `roles` list, rather than failing the whole response over one bad entry —
 * `../ui/identifiedArchitecture`'s graph conversion then simply leaves that
 * module out of the identified diagram.
 */
export function parseArchitectureIdentification(input: unknown, knownGroupIds: ReadonlySet<string>): ArchitectureIdentification {
	if (typeof input !== 'object' || input === null) {
		throw new Error("Claude's identify_architecture call was missing its input.");
	}

	const { patternName, patternDescription, roles, assignments } = input as Record<string, unknown>;
	if (typeof patternName !== 'string' || patternName.trim().length === 0) {
		throw new Error('Claude\'s identify_architecture call must include a non-empty "patternName" string.');
	}
	if (typeof patternDescription !== 'string' || patternDescription.trim().length === 0) {
		throw new Error('Claude\'s identify_architecture call must include a non-empty "patternDescription" string.');
	}
	if (!Array.isArray(roles)) {
		throw new Error('Claude\'s identify_architecture call must include a "roles" array.');
	}
	if (!Array.isArray(assignments)) {
		throw new Error('Claude\'s identify_architecture call must include an "assignments" array.');
	}

	const parsedRoles = roles.map((entry, index) => parseRoleDefinition(entry, index));
	const knownRoles = new Set(parsedRoles.map((role) => role.role));

	const parsedAssignments: ArchitectureRoleAssignment[] = [];
	for (const entry of assignments) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}
		const { groupId, role } = entry as Record<string, unknown>;
		if (typeof groupId !== 'string' || !knownGroupIds.has(groupId) || typeof role !== 'string' || !knownRoles.has(role)) {
			continue;
		}
		parsedAssignments.push({ groupId, role });
	}

	return { patternName, patternDescription, roles: parsedRoles, assignments: parsedAssignments };
}

function parseRoleDefinition(value: unknown, index: number): ArchitectureRoleDefinition {
	if (typeof value !== 'object' || value === null) {
		throw new Error(`Claude's identify_architecture call: "roles[${index}]" must be an object.`);
	}
	const { role, description } = value as Record<string, unknown>;
	if (typeof role !== 'string' || role.trim().length === 0) {
		throw new Error(`Claude's identify_architecture call: "roles[${index}].role" must be a non-empty string.`);
	}
	if (typeof description !== 'string' || description.trim().length === 0) {
		throw new Error(`Claude's identify_architecture call: "roles[${index}].description" must be a non-empty string.`);
	}
	return { role, description };
}
