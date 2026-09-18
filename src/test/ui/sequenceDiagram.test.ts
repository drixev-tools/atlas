import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeWorkspace } from '../../ui/analyzeWorkspace';
import {
	applySequenceDiagramNarration,
	buildFallbackSequenceDiagramViewState,
	buildFallbackSequenceSummary,
	loadActiveFileSequenceContext,
	loadSequenceFunctionCandidates,
	toSequenceDiagramNarrationInput
} from '../../ui/sequenceDiagram';
import { SequenceContext } from '../../core/sequenceContext';

function writeFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

suite('loadSequenceFunctionCandidates', () => {
	let tmpDir: string;
	let dbPath: string;

	setup(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sequence-'));
		dbPath = path.join(tmpDir, 'atlas.db');
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('lists the functions declared in the active file, in declaration order', async () => {
		const appPath = writeFile(tmpDir, 'app.ts', 'export function first(): void {}\nexport function second(): void {}\n');
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		const resolved = await loadSequenceFunctionCandidates(dbPath, appPath);

		assert.deepStrictEqual(
			resolved?.candidates.map((candidate) => candidate.name),
			['first', 'second']
		);
	});

	test('returns undefined for a file outside the Atlas graph', async () => {
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });
		const resolved = await loadSequenceFunctionCandidates(dbPath, path.join(tmpDir, 'missing.ts'));
		assert.strictEqual(resolved, undefined);
	});
});

suite('loadActiveFileSequenceContext', () => {
	let tmpDir: string;
	let dbPath: string;

	setup(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sequence-'));
		dbPath = path.join(tmpDir, 'atlas.db');
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("combines the active file's import ancestry with the chosen function's own outgoing call chain", async () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		const appPath = writeFile(tmpDir, 'app.ts', "import { add } from './math';\nexport function run(): number {\n\treturn add(1, 2);\n}\n");
		writeFile(tmpDir, 'index.ts', "import './app';\n");
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		const resolved = await loadSequenceFunctionCandidates(dbPath, appPath);
		const runCandidate = resolved?.candidates.find((candidate) => candidate.name === 'run');
		assert.ok(resolved && runCandidate, 'expected a "run" function candidate in app.ts');

		const context = await loadActiveFileSequenceContext(dbPath, resolved.activeFileId, runCandidate.id);
		assert.ok(context, 'expected a combined sequence context');

		assert.strictEqual(context.target.name, 'run');
		assert.ok(
			context.lifelines.some((lifeline) => lifeline.label === 'index.ts'),
			'expected the ancestor file to appear as a lifeline'
		);
		const callStep = context.steps.find((step) => step.kind === 'calls');
		const callee = context.participants.find((participant) => participant.id === callStep?.toParticipantId);
		assert.strictEqual(callee?.name, 'add');
	});

	test('returns undefined when the function id is no longer in the graph', async () => {
		const appPath = writeFile(tmpDir, 'app.ts', 'export function run(): void {}\n');
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });
		const resolved = await loadSequenceFunctionCandidates(dbPath, appPath);
		assert.ok(resolved);

		const context = await loadActiveFileSequenceContext(dbPath, resolved.activeFileId, 'fn:missing');
		assert.strictEqual(context, undefined);
	});
});

function sampleContext(overrides: Partial<SequenceContext> = {}): SequenceContext {
	return {
		target: { id: 'fn:foo', name: 'foo', kind: 'function', filePath: '/repo/math.ts', lifelineId: 'file:/repo/math.ts' },
		participants: [
			{ id: 'fn:foo', name: 'foo', kind: 'function', filePath: '/repo/math.ts', lifelineId: 'file:/repo/math.ts' },
			{ id: 'fn:qux', name: 'qux', kind: 'function', filePath: '/repo/math.ts', lifelineId: 'file:/repo/math.ts' }
		],
		lifelines: [{ id: 'file:/repo/math.ts', label: 'math.ts', kind: 'file', filePath: '/repo/math.ts' }],
		steps: [{ id: 'calls:foo:qux', order: 0, fromParticipantId: 'fn:foo', toParticipantId: 'fn:qux', action: 'calls qux', line: 3 }],
		truncated: false,
		...overrides
	};
}

suite('toSequenceDiagramNarrationInput', () => {
	test('maps target/steps to participant names and each step\'s default action', () => {
		const input = toSequenceDiagramNarrationInput(sampleContext());

		assert.deepStrictEqual(input.target, { name: 'foo', kind: 'function' });
		assert.deepStrictEqual(input.steps, [{ order: 0, from: 'foo', to: 'qux', defaultAction: 'calls qux', kind: 'calls' }]);
	});
});

suite('buildFallbackSequenceSummary', () => {
	test('reports the step/lifeline counts when there are steps', () => {
		const summary = buildFallbackSequenceSummary(sampleContext());
		assert.match(summary, /1 call\(s\)/);
		assert.match(summary, /1 lifeline\(s\)/);
	});

	test('mentions truncation when the chain was cut off', () => {
		const summary = buildFallbackSequenceSummary(sampleContext({ truncated: true }));
		assert.match(summary, /left out/);
	});

	test('reports no resolvable calls when there are no steps', () => {
		const summary = buildFallbackSequenceSummary(sampleContext({ steps: [] }));
		assert.match(summary, /No resolvable calls/);
	});
});

suite('buildFallbackSequenceDiagramViewState', () => {
	test('carries the target, lifelines, participants and default step labels, not AI-generated', () => {
		const state = buildFallbackSequenceDiagramViewState(sampleContext());

		assert.strictEqual(state.targetId, 'fn:foo');
		assert.strictEqual(state.targetLifelineId, 'file:/repo/math.ts');
		assert.strictEqual(state.aiGenerated, false);
		assert.deepStrictEqual(state.lifelines, sampleContext().lifelines);
		assert.deepStrictEqual(state.participants, sampleContext().participants);
		assert.deepStrictEqual(state.steps, [
			{ id: 'calls:foo:qux', order: 0, fromParticipantId: 'fn:foo', toParticipantId: 'fn:qux', label: 'calls qux', kind: 'calls', line: 3 }
		]);
	});
});

suite('applySequenceDiagramNarration', () => {
	test('overrides the summary and matching step labels, marking the state AI-generated', () => {
		const state = applySequenceDiagramNarration(sampleContext(), {
			summary: 'foo delegates to qux.',
			stepLabels: [{ order: 0, label: 'delegates to qux' }]
		});

		assert.strictEqual(state.aiGenerated, true);
		assert.strictEqual(state.summary, 'foo delegates to qux.');
		assert.strictEqual(state.steps[0].label, 'delegates to qux');
	});

	test('ignores a stepLabels entry whose order has no matching step', () => {
		const state = applySequenceDiagramNarration(sampleContext(), {
			summary: 'foo delegates to qux.',
			stepLabels: [{ order: 99, label: 'unrelated' }]
		});

		assert.strictEqual(state.steps[0].label, 'calls qux');
	});
});
