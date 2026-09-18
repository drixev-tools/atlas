import * as assert from 'assert';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { AtlasStore } from '../../core/store';
import { buildActiveFileSequenceContext, buildSequenceContext, listSequenceFunctionCandidates } from '../../core/sequenceContext';

function fileNode(id: string, filePath: string): GraphNode {
	return { id, kind: 'file', name: path.basename(filePath), filePath, language: 'typescript' };
}

function functionNode(id: string, name: string, filePath: string, startLine = 1): GraphNode {
	return { id, kind: 'function', name, filePath, language: 'typescript', range: { startLine, startColumn: 1, endLine: startLine, endColumn: 1 } };
}

function methodNode(id: string, name: string, filePath: string, startLine = 1): GraphNode {
	return { id, kind: 'method', name, filePath, language: 'typescript', range: { startLine, startColumn: 1, endLine: startLine, endColumn: 1 } };
}

function classNode(id: string, name: string, filePath: string): GraphNode {
	return { id, kind: 'class', name, filePath, language: 'typescript' };
}

function containsEdge(sourceId: string, targetId: string): GraphEdge {
	return { id: `contains:${sourceId}:${targetId}`, kind: 'contains', source: sourceId, target: targetId };
}

function callsEdge(id: string, sourceId: string, targetId: string, order: number, line = order): GraphEdge {
	return { id, kind: 'calls', source: sourceId, target: targetId, metadata: { order, line } };
}

function instantiatesEdge(id: string, sourceId: string, targetId: string): GraphEdge {
	return { id, kind: 'instantiates', source: sourceId, target: targetId, metadata: { order: 0, line: 0 } };
}

function importsEdge(id: string, sourceId: string, targetId: string): GraphEdge {
	return { id, kind: 'imports', source: sourceId, target: targetId };
}

suite('buildSequenceContext', () => {
	let store: AtlasStore;

	setup(async () => {
		store = await AtlasStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('returns undefined for a node kind outside function/file', () => {
		store.upsertNodes([classNode('class:foo', 'Foo', '/project/a.ts')]);
		assert.strictEqual(buildSequenceContext(store, 'class:foo'), undefined);
	});

	test('returns undefined for an id not in the graph', () => {
		assert.strictEqual(buildSequenceContext(store, 'file:missing.ts'), undefined);
	});

	test('a method target traces its own outgoing calls, same as a plain function', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			classNode('class:Thing', 'Thing', '/project/a.ts'),
			methodNode('method:run', 'run', '/project/a.ts'),
			functionNode('fn:helper', 'helper', '/project/a.ts')
		]);
		store.upsertEdges([
			containsEdge('file:a.ts', 'class:Thing'),
			containsEdge('class:Thing', 'method:run'),
			containsEdge('file:a.ts', 'fn:helper'),
			callsEdge('calls:run:helper', 'method:run', 'fn:helper', 0)
		]);

		const context = buildSequenceContext(store, 'method:run');

		assert.strictEqual(context?.target.id, 'method:run');
		assert.deepStrictEqual(
			context?.steps.map((step) => step.toParticipantId),
			['fn:helper']
		);
	});

	test('a function target with no outgoing/incoming calls has itself as its only participant, no steps', () => {
		store.upsertNodes([fileNode('file:a.ts', '/project/a.ts'), functionNode('fn:foo', 'foo', '/project/a.ts')]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:foo')]);

		const context = buildSequenceContext(store, 'fn:foo');

		assert.strictEqual(context?.target.id, 'fn:foo');
		assert.deepStrictEqual(context?.participants.map((p) => p.id), ['fn:foo']);
		assert.deepStrictEqual(context?.steps, []);
		assert.strictEqual(context?.truncated, false);
	});

	test('orders outgoing calls by metadata.order, not by insertion order', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:foo', 'foo', '/project/a.ts'),
			functionNode('fn:bar', 'bar', '/project/a.ts'),
			functionNode('fn:baz', 'baz', '/project/a.ts')
		]);
		store.upsertEdges([
			containsEdge('file:a.ts', 'fn:foo'),
			callsEdge('calls:foo:baz', 'fn:foo', 'fn:baz', 1),
			callsEdge('calls:foo:bar', 'fn:foo', 'fn:bar', 0)
		]);

		const context = buildSequenceContext(store, 'fn:foo');

		assert.deepStrictEqual(
			context?.steps.map((step) => step.toParticipantId),
			['fn:bar', 'fn:baz']
		);
		assert.deepStrictEqual(
			context?.steps.map((step) => step.order),
			[0, 1]
		);
	});

	test('ignores instantiates edges, following only calls edges', () => {
		store.upsertNodes([fileNode('file:a.ts', '/project/a.ts'), functionNode('fn:foo', 'foo', '/project/a.ts'), classNode('class:Thing', 'Thing', '/project/a.ts')]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:foo'), instantiatesEdge('inst:foo:thing', 'fn:foo', 'class:Thing')]);

		const context = buildSequenceContext(store, 'fn:foo');

		assert.deepStrictEqual(context?.steps, []);
	});

	test('groups a class method participant by its class lifeline; a plain function gets its own lifeline', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:foo', 'foo', '/project/a.ts'),
			classNode('class:Thing', 'Thing', '/project/a.ts'),
			methodNode('method:run', 'run', '/project/a.ts')
		]);
		store.upsertEdges([
			containsEdge('file:a.ts', 'fn:foo'),
			containsEdge('file:a.ts', 'class:Thing'),
			containsEdge('class:Thing', 'method:run'),
			callsEdge('calls:foo:run', 'fn:foo', 'method:run', 0)
		]);

		const context = buildSequenceContext(store, 'fn:foo');

		const fooParticipant = context?.participants.find((p) => p.id === 'fn:foo');
		const runParticipant = context?.participants.find((p) => p.id === 'method:run');
		assert.strictEqual(fooParticipant?.lifelineId, 'fn:foo');
		assert.strictEqual(runParticipant?.lifelineId, 'class:Thing');

		const fooLifeline = context?.lifelines.find((l) => l.id === 'fn:foo');
		assert.strictEqual(fooLifeline?.kind, 'function');
		assert.strictEqual(fooLifeline?.label, 'foo');

		const classLifeline = context?.lifelines.find((l) => l.id === 'class:Thing');
		assert.strictEqual(classLifeline?.kind, 'class');
		assert.strictEqual(classLifeline?.label, 'Thing');
	});

	test('two standalone functions in the same file get distinct lifelines, not a shared self-messaging one', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:first', 'first', '/project/a.ts', 5),
			functionNode('fn:second', 'second', '/project/a.ts', 20)
		]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:first'), callsEdge('calls:first:second', 'fn:first', 'fn:second', 0)]);

		const context = buildSequenceContext(store, 'fn:first');

		const firstParticipant = context?.participants.find((p) => p.id === 'fn:first');
		const secondParticipant = context?.participants.find((p) => p.id === 'fn:second');
		assert.strictEqual(firstParticipant?.lifelineId, 'fn:first');
		assert.strictEqual(secondParticipant?.lifelineId, 'fn:second');
		assert.notStrictEqual(firstParticipant?.lifelineId, secondParticipant?.lifelineId);
	});

	test('stops following calls beyond maxDepth and reports the chain as truncated', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:a', 'a', '/project/a.ts'),
			functionNode('fn:b', 'b', '/project/a.ts'),
			functionNode('fn:c', 'c', '/project/a.ts')
		]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:a'), callsEdge('calls:a:b', 'fn:a', 'fn:b', 0), callsEdge('calls:b:c', 'fn:b', 'fn:c', 0)]);

		const context = buildSequenceContext(store, 'fn:a', { maxDepth: 1 });

		assert.deepStrictEqual(
			context?.steps.map((step) => step.toParticipantId),
			['fn:b']
		);
		assert.strictEqual(context?.truncated, true);
	});

	test('caps the total step count at maxSteps and reports the chain as truncated', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:a', 'a', '/project/a.ts'),
			functionNode('fn:b', 'b', '/project/a.ts'),
			functionNode('fn:c', 'c', '/project/a.ts')
		]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:a'), callsEdge('calls:a:b', 'fn:a', 'fn:b', 0), callsEdge('calls:a:c', 'fn:a', 'fn:c', 1)]);

		const context = buildSequenceContext(store, 'fn:a', { maxSteps: 1 });

		assert.strictEqual(context?.steps.length, 1);
		assert.strictEqual(context?.truncated, true);
	});

	test('is cycle-safe: mutual recursion produces one step per direction instead of looping forever', () => {
		store.upsertNodes([fileNode('file:a.ts', '/project/a.ts'), functionNode('fn:a', 'a', '/project/a.ts'), functionNode('fn:b', 'b', '/project/a.ts')]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:a'), callsEdge('calls:a:b', 'fn:a', 'fn:b', 0), callsEdge('calls:b:a', 'fn:b', 'fn:a', 0)]);

		const context = buildSequenceContext(store, 'fn:a');

		assert.deepStrictEqual(
			context?.steps.map((step) => [step.fromParticipantId, step.toParticipantId]),
			[
				['fn:a', 'fn:b'],
				['fn:b', 'fn:a']
			]
		);
	});

	test('a file target traces from its top-level functions in declaration order, skipping methods nested in classes', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:second', 'second', '/project/a.ts', 20),
			functionNode('fn:first', 'first', '/project/a.ts', 5),
			classNode('class:Thing', 'Thing', '/project/a.ts'),
			methodNode('method:run', 'run', '/project/a.ts')
		]);
		store.upsertEdges([
			containsEdge('file:a.ts', 'fn:second'),
			containsEdge('file:a.ts', 'fn:first'),
			containsEdge('file:a.ts', 'class:Thing'),
			containsEdge('class:Thing', 'method:run'),
			callsEdge('calls:first:target', 'fn:first', 'fn:second', 0)
		]);

		const context = buildSequenceContext(store, 'file:a.ts');

		assert.deepStrictEqual(
			context?.participants.map((p) => p.id),
			['file:a.ts', 'fn:first', 'fn:second']
		);
		assert.deepStrictEqual(
			context?.steps.map((step) => [step.fromParticipantId, step.toParticipantId]),
			[['fn:first', 'fn:second']]
		);
		assert.strictEqual(context?.target.lifelineId, 'file:a.ts');

		const firstParticipant = context?.participants.find((p) => p.id === 'fn:first');
		const secondParticipant = context?.participants.find((p) => p.id === 'fn:second');
		assert.strictEqual(firstParticipant?.lifelineId, 'fn:first');
		assert.strictEqual(secondParticipant?.lifelineId, 'fn:second');
	});
});

suite('listSequenceFunctionCandidates', () => {
	let store: AtlasStore;

	setup(async () => {
		store = await AtlasStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('lists top-level functions and class methods, in declaration order, tagging methods with their class', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:second', 'second', '/project/a.ts', 20),
			functionNode('fn:first', 'first', '/project/a.ts', 5),
			classNode('class:Thing', 'Thing', '/project/a.ts'),
			methodNode('method:run', 'run', '/project/a.ts', 12)
		]);
		store.upsertEdges([
			containsEdge('file:a.ts', 'fn:second'),
			containsEdge('file:a.ts', 'fn:first'),
			containsEdge('file:a.ts', 'class:Thing'),
			containsEdge('class:Thing', 'method:run')
		]);

		const candidates = listSequenceFunctionCandidates(store, 'file:a.ts');

		assert.deepStrictEqual(
			candidates.map((candidate) => [candidate.name, candidate.containerName]),
			[
				['first', undefined],
				['run', 'Thing'],
				['second', undefined]
			]
		);
	});
});

suite('buildActiveFileSequenceContext', () => {
	let store: AtlasStore;

	setup(async () => {
		store = await AtlasStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('returns undefined when activeFileId is not a file node', () => {
		store.upsertNodes([functionNode('fn:foo', 'foo', '/project/a.ts')]);
		assert.strictEqual(buildActiveFileSequenceContext(store, 'fn:foo', 'fn:foo'), undefined);
	});

	test('returns undefined when functionId is not a function/method node', () => {
		store.upsertNodes([fileNode('file:a.ts', '/project/a.ts'), classNode('class:Thing', 'Thing', '/project/a.ts')]);
		assert.strictEqual(buildActiveFileSequenceContext(store, 'file:a.ts', 'class:Thing'), undefined);
	});

	test("orders the active file's import ancestry oldest-first, ahead of a declares step and the function's own call chain", () => {
		store.upsertNodes([
			fileNode('file:root.ts', '/project/root.ts'),
			fileNode('file:parent.ts', '/project/parent.ts'),
			fileNode('file:app.ts', '/project/app.ts'),
			fileNode('file:math.ts', '/project/math.ts'),
			functionNode('fn:run', 'run', '/project/app.ts'),
			functionNode('fn:add', 'add', '/project/math.ts')
		]);
		store.upsertEdges([
			importsEdge('imports:root:parent', 'file:root.ts', 'file:parent.ts'),
			importsEdge('imports:parent:app', 'file:parent.ts', 'file:app.ts'),
			containsEdge('file:app.ts', 'fn:run'),
			containsEdge('file:math.ts', 'fn:add'),
			callsEdge('calls:run:add', 'fn:run', 'fn:add', 0)
		]);

		const context = buildActiveFileSequenceContext(store, 'file:app.ts', 'fn:run');

		assert.deepStrictEqual(
			context?.steps.map((step) => [step.kind, step.fromParticipantId, step.toParticipantId]),
			[
				['imports', 'file:root.ts', 'file:parent.ts'],
				['imports', 'file:parent.ts', 'file:app.ts'],
				['declares', 'file:app.ts', 'fn:run'],
				['calls', 'fn:run', 'fn:add']
			]
		);
		assert.deepStrictEqual(
			context?.steps.map((step) => step.order),
			[0, 1, 2, 3]
		);
		assert.strictEqual(context?.target.id, 'fn:run');
		assert.deepStrictEqual(
			context?.lifelines.map((lifeline) => lifeline.id),
			['file:root.ts', 'file:parent.ts', 'file:app.ts', 'fn:run', 'fn:add']
		);
	});

	test('includes every ancestor chain when the active file has more than one importer', () => {
		store.upsertNodes([
			fileNode('file:rootA.ts', '/project/rootA.ts'),
			fileNode('file:rootB.ts', '/project/rootB.ts'),
			fileNode('file:app.ts', '/project/app.ts'),
			functionNode('fn:run', 'run', '/project/app.ts')
		]);
		store.upsertEdges([
			importsEdge('imports:a:app', 'file:rootA.ts', 'file:app.ts'),
			importsEdge('imports:b:app', 'file:rootB.ts', 'file:app.ts'),
			containsEdge('file:app.ts', 'fn:run')
		]);

		const context = buildActiveFileSequenceContext(store, 'file:app.ts', 'fn:run');

		const importSteps = context?.steps.filter((step) => step.kind === 'imports') ?? [];
		assert.deepStrictEqual(
			importSteps.map((step) => step.fromParticipantId).sort(),
			['file:rootA.ts', 'file:rootB.ts']
		);
	});

	test('a file with no importers of its own is just itself, with only a declares step', () => {
		store.upsertNodes([fileNode('file:app.ts', '/project/app.ts'), functionNode('fn:run', 'run', '/project/app.ts')]);
		store.upsertEdges([containsEdge('file:app.ts', 'fn:run')]);

		const context = buildActiveFileSequenceContext(store, 'file:app.ts', 'fn:run');

		assert.deepStrictEqual(
			context?.steps.map((step) => step.kind),
			['declares']
		);
	});
});
