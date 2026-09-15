import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeDesignClient } from '../../design/claudeClient';
import { ProjectIntent, ProposedArchitecture } from '../../design/model';
import { ProjectGraphStore } from '../../core/store';
import { designProject } from '../../ui/designProject';

function fakeIntent(overrides: Partial<ProjectIntent> = {}): ProjectIntent {
	return {
		name: 'Auth Service',
		stack: 'typescript',
		keyComponents: ['loginService'],
		description: 'A service that handles user login.',
		...overrides
	};
}

function fakeClaudeClient(architecture: ProposedArchitecture): ClaudeDesignClient {
	return { proposeArchitecture: async () => architecture };
}

const SIMPLE_ARCHITECTURE: ProposedArchitecture = {
	nodes: [
		{ ref: 'file', kind: 'file', name: 'loginService.ts', filePath: 'src/auth/loginService.ts' },
		{ ref: 'cls', kind: 'class', name: 'LoginService', filePath: 'src/auth/loginService.ts' }
	],
	edges: [{ kind: 'contains', sourceRef: 'file', targetRef: 'cls' }]
};

suite('designProject', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-design-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('persists Claude\'s proposed architecture as a proposed_only graph', async () => {
		const result = await designProject({
			rootDir: tmpDir,
			intent: fakeIntent(),
			claudeClient: fakeClaudeClient(SIMPLE_ARCHITECTURE)
		});

		assert.strictEqual(result.nodeCount, 2);
		assert.strictEqual(result.edgeCount, 1);
	});

	test('coexists with an already-populated observed graph instead of replacing it', async () => {
		const store = await ProjectGraphStore.open();
		try {
			store.upsertNode({ id: 'file:existing', kind: 'file', name: 'existing.ts', filePath: path.join(tmpDir, 'existing.ts') });

			const dbPath = path.join(tmpDir, 'project-graph.db');
			store.save(dbPath);

			await designProject({ rootDir: tmpDir, dbPath, intent: fakeIntent(), claudeClient: fakeClaudeClient(SIMPLE_ARCHITECTURE) });

			const reopened = await ProjectGraphStore.open({ filePath: dbPath });
			try {
				assert.strictEqual(reopened.getNode('file:existing')?.status, 'observed_only');
				assert.strictEqual(reopened.listNodes({ status: 'proposed_only' }).length, 2);
			} finally {
				reopened.close();
			}
		} finally {
			store.close();
		}
	});

	test('a second run replaces the previous proposed graph instead of accumulating it', async () => {
		const dbPath = path.join(tmpDir, 'project-graph.db');

		await designProject({ rootDir: tmpDir, dbPath, intent: fakeIntent(), claudeClient: fakeClaudeClient(SIMPLE_ARCHITECTURE) });
		const second = await designProject({
			rootDir: tmpDir,
			dbPath,
			intent: fakeIntent(),
			claudeClient: fakeClaudeClient({ nodes: [{ ref: 'n1', kind: 'module', name: 'billing' }], edges: [] })
		});

		assert.strictEqual(second.nodeCount, 1);
		assert.strictEqual(second.edgeCount, 0);
	});

	test('reports progress for each stage in order', async () => {
		const messages: string[] = [];
		await designProject({
			rootDir: tmpDir,
			intent: fakeIntent(),
			claudeClient: fakeClaudeClient(SIMPLE_ARCHITECTURE),
			onProgress: (message) => messages.push(message)
		});

		assert.deepStrictEqual(messages, [
			'Asking Claude to propose an architecture...',
			'Building Proposed Graph...',
			'Updating Project Graph...'
		]);
	});
});
