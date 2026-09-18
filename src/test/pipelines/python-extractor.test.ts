import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PythonServer } from '../../pipelines/python/server';
import { extractFiles } from '../../pipelines/python/extractor';

function writeTempFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

suite('Python pipeline: extractor', () => {
	let tmpDir: string;
	let server: PythonServer;

	setup(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-py-extractor-'));
		server = new PythonServer();
		await server.start();
	});

	teardown(async () => {
		await server.stop();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('extracts top-level symbols and their exported status', async () => {
		const filePath = writeTempFile(
			tmpDir,
			'sample.py',
			[
				'def greet(name):',
				'    return f"hi {name}"',
				'',
				'def _helper():',
				'    pass',
				'',
				'class Widget:',
				'    label = "widget"',
				'',
				'    def render(self):',
				'        pass',
				'',
				'answer = 42'
			].join('\n')
		);

		const { files, errors } = await extractFiles(server, [filePath]);
		assert.deepStrictEqual(errors, []);
		assert.strictEqual(files.length, 1);

		const byName = (name: string) => files[0].symbols.find((s) => s.name === name);

		assert.strictEqual(byName('greet')?.kind, 'function');
		assert.strictEqual(byName('greet')?.exported, true);

		assert.strictEqual(byName('_helper')?.kind, 'function');
		assert.strictEqual(byName('_helper')?.exported, false);

		assert.strictEqual(byName('Widget')?.kind, 'class');
		assert.strictEqual(byName('Widget')?.exported, true);

		assert.strictEqual(byName('render')?.kind, 'method');
		assert.strictEqual(byName('render')?.parentName, 'Widget');

		assert.strictEqual(byName('label')?.kind, 'property');
		assert.strictEqual(byName('label')?.parentName, 'Widget');

		assert.strictEqual(byName('answer')?.kind, 'variable');
		assert.strictEqual(byName('answer')?.exported, true);
	});

	test('honors __all__ over the leading-underscore convention', async () => {
		const filePath = writeTempFile(
			tmpDir,
			'dunder_all.py',
			['__all__ = ["_private_but_exported"]', '', 'def _private_but_exported():', '    pass', '', 'def public_but_not_exported():', '    pass'].join(
				'\n'
			)
		);

		const { files } = await extractFiles(server, [filePath]);
		const byName = (name: string) => files[0].symbols.find((s) => s.name === name);

		assert.strictEqual(byName('_private_but_exported')?.exported, true);
		assert.strictEqual(byName('public_but_not_exported')?.exported, false);
	});

	test('extracts absolute, aliased, and relative imports', async () => {
		const filePath = writeTempFile(
			tmpDir,
			'imports.py',
			[
				'import os',
				'import os.path as osp',
				'from collections import OrderedDict, defaultdict as dd',
				'from . import sibling',
				'from .pkg import thing',
				'from ..parent import other'
			].join('\n')
		);

		const { files } = await extractFiles(server, [filePath]);
		const imports = files[0].imports;

		assert.strictEqual(imports.length, 6);

		const byModule = (specifier: string) => imports.find((i) => i.moduleSpecifier === specifier);

		assert.deepStrictEqual(byModule('os')?.importedNames, ['*']);
		assert.strictEqual(byModule('os')?.isRelative, false);

		assert.deepStrictEqual(byModule('os.path')?.importedNames, ['*']);

		assert.deepStrictEqual(byModule('collections')?.importedNames, ['OrderedDict', 'defaultdict']);
		assert.strictEqual(byModule('collections')?.isRelative, false);

		const sibling = imports.find((i) => i.moduleSpecifier === '' && i.importedNames.includes('sibling'));
		assert.ok(sibling, 'expected a relative import for "from . import sibling"');
		assert.strictEqual(sibling?.isRelative, true);
		assert.strictEqual(sibling?.relativeLevel, 1);

		assert.strictEqual(byModule('pkg')?.isRelative, true);
		assert.strictEqual(byModule('pkg')?.relativeLevel, 1);

		assert.strictEqual(byModule('parent')?.isRelative, true);
		assert.strictEqual(byModule('parent')?.relativeLevel, 2);
	});

	test('records an unresolved call instead of guessing its target', async () => {
		const filePath = writeTempFile(
			tmpDir,
			'unresolved.py',
			['def run(thing):', '    thing.do_something()', '    unknown_name()'].join('\n')
		);

		const { files } = await extractFiles(server, [filePath]);
		const [file] = files;

		assert.strictEqual(file.relations.filter((r) => r.kind === 'calls').length, 0);
		assert.strictEqual(file.unresolved.length, 2);
		assert.ok(file.unresolved.every((u) => u.kind === 'calls' && u.enclosingName === 'run'));
		assert.deepStrictEqual(
			file.unresolved.map((u) => u.name).sort(),
			['thing.do_something', 'unknown_name']
		);
	});

	test('reports syntax errors instead of failing the whole batch', async () => {
		const goodFile = writeTempFile(tmpDir, 'good.py', 'def ok():\n    pass\n');
		const badFile = writeTempFile(tmpDir, 'bad.py', 'def broken(:\n    pass\n');

		const { files, errors } = await extractFiles(server, [goodFile, badFile]);

		assert.strictEqual(files.length, 1);
		assert.strictEqual(files[0].filePath, goodFile);
		assert.strictEqual(errors.length, 1);
		assert.strictEqual(errors[0].filePath, badFile);
	});
});
