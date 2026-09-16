// Claude integration for the AI-generated impact explanation: turns the
// structural dependency/consumer/test breakdown `../core/impact` already
// computes (via `../ui/impact`'s `calculateImpact`) into a short,
// plain-language explanation, mirroring how ./claudeClient turns a
// `ProjectIntent` into a `ProposedArchitecture` for Design Project.
// Takes a narrow `ImpactSummaryInput` instead of importing `../ui/impact`'s
// `CalculateImpactResult` directly, keeping this design-layer module free of
// any dependency on the ui layer, like ./claudeClient and ./apiKey.
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_CLAUDE_MODEL } from './claudeClient';

const MAX_OUTPUT_TOKENS = 768;

export interface ImpactSummaryTarget {
	filePath: string;
	dependencies: string[];
	consumers: string[];
	relatedTests: string[];
}

export interface ImpactSummaryInput {
	/** Where the target file set came from — always one of these two, since there is nothing to explain for "none". */
	source: 'git' | 'activeFile';
	targets: ImpactSummaryTarget[];
	/** Union of every target's consumers, transitively, minus the targets themselves. */
	impactedFiles: string[];
	/** Union of the tests related to the targets and to `impactedFiles`. */
	relatedTests: string[];
}

/**
 * What the Impact view (../ui/impactView) needs from Claude, narrowed to an
 * interface — separate from the concrete `AnthropicClaudeImpactClient` — so
 * tests can supply a fake response instead of making a real network call,
 * matching `ClaudeDesignClient` (./claudeClient).
 */
export interface ClaudeImpactClient {
	explainImpact(summary: ImpactSummaryInput): Promise<string>;
}

export class AnthropicClaudeImpactClient implements ClaudeImpactClient {
	private readonly client: Anthropic;

	constructor(apiKey: string, private readonly model: string = DEFAULT_CLAUDE_MODEL) {
		this.client = new Anthropic({ apiKey });
	}

	async explainImpact(summary: ImpactSummaryInput): Promise<string> {
		const message = await this.client.messages.create({
			model: this.model,
			max_tokens: MAX_OUTPUT_TOKENS,
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content: buildUserPrompt(summary) }]
		});

		const text = message.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
		if (!text || text.text.trim().length === 0) {
			throw new Error('Claude did not return an impact explanation.');
		}
		return text.text.trim();
	}
}

const SYSTEM_PROMPT = `You are helping a developer understand the impact of a code change they are about to make, right before they commit it.

You will be given an already-computed structural analysis: which files changed, what each changed file depends on and is depended on by (consumers), which files are transitively impacted, and which tests relate to any of that. Treat these lists as ground truth — never invent a file, dependency, consumer, or test that isn't listed.

Write a concise, plain-language explanation (a short paragraph, optionally followed by a few bullet points) of what this change affects and why it matters to the developer. Be non-exhaustive: highlight what's most worth knowing rather than repeating every listed file. Do not include a title or preamble — start directly with the explanation.`;

function buildUserPrompt(summary: ImpactSummaryInput): string {
	const sourceLabel = summary.source === 'git' ? "the developer's uncommitted git changes" : 'the active editor file';

	const lines: string[] = [`Explain the impact of a change to ${sourceLabel}.`, '', 'Changed file(s):'];
	for (const target of summary.targets) {
		lines.push(`- ${target.filePath}`);
		if (target.dependencies.length > 0) {
			lines.push(`  depends on: ${target.dependencies.join(', ')}`);
		}
		if (target.consumers.length > 0) {
			lines.push(`  consumed by: ${target.consumers.join(', ')}`);
		}
		if (target.relatedTests.length > 0) {
			lines.push(`  related tests: ${target.relatedTests.join(', ')}`);
		}
	}

	lines.push(
		'',
		`Files transitively impacted (consumers of the changed files, directly or through others): ${
			summary.impactedFiles.length > 0 ? summary.impactedFiles.join(', ') : 'none'
		}`,
		`All related tests: ${summary.relatedTests.length > 0 ? summary.relatedTests.join(', ') : 'none'}`
	);
	return lines.join('\n');
}
