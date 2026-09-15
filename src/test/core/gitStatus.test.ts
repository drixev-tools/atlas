import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitStatusProvider } from '../../core/gitStatus';

suite('GitStatusProvider', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-git-status-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('resolves to an empty list, instead of throwing, for a directory with no associated git repository', async () => {
		const provider = new GitStatusProvider();
		await assert.doesNotReject(provider.getChangedFiles(tmpDir));
		assert.deepStrictEqual(await provider.getChangedFiles(tmpDir), []);
	});

	test('a second call for the same root is served without re-fetching failing/throwing', async () => {
		const provider = new GitStatusProvider({ ttlMs: 50 });
		const first = await provider.getChangedFiles(tmpDir);
		const second = await provider.getChangedFiles(tmpDir);
		assert.deepStrictEqual(first, []);
		assert.deepStrictEqual(second, []);
	});

	test('a call after the cache has gone stale still resolves without throwing (background refresh path)', async () => {
		const provider = new GitStatusProvider({ ttlMs: 1 });
		await provider.getChangedFiles(tmpDir);
		await new Promise((resolve) => setTimeout(resolve, 10));
		await assert.doesNotReject(provider.getChangedFiles(tmpDir));
	});
});
