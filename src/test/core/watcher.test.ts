import * as assert from 'assert';
import * as path from 'path';
import { languageForFile } from '../../core/watcher';

suite('ProjectGraphWatcher: language routing', () => {
	test('routes TS/JS extensions to the TS pipeline', () => {
		for (const name of ['index.ts', 'component.tsx', 'script.js', 'component.jsx']) {
			assert.strictEqual(languageForFile(path.join('/project', name)), 'ts', name);
		}
	});

	test('routes .py to the Python pipeline', () => {
		assert.strictEqual(languageForFile(path.join('/project', 'main.py')), 'python');
	});

	test('ignores declaration files', () => {
		assert.strictEqual(languageForFile(path.join('/project', 'index.d.ts')), undefined);
	});

	test('ignores files under vendored/build directories', () => {
		assert.strictEqual(languageForFile(path.join('/project', 'node_modules', 'pkg', 'index.js')), undefined);
		assert.strictEqual(languageForFile(path.join('/project', 'dist', 'out.js')), undefined);
		assert.strictEqual(languageForFile(path.join('/project', '.venv', 'lib', 'mod.py')), undefined);
	});

	test('ignores unrelated extensions', () => {
		assert.strictEqual(languageForFile(path.join('/project', 'README.md')), undefined);
	});
});
