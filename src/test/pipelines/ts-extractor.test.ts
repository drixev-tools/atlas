import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgramForFiles } from '../../pipelines/ts/program';
import { extractFile } from '../../pipelines/ts/extractor';

function writeTempFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

suite('TS pipeline: extractor', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-extractor-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('extracts top-level symbols and their exported status', () => {
		const filePath = writeTempFile(
			tmpDir,
			'sample.ts',
			[
				'export function greet(name: string): string { return `hi ${name}`; }',
				'class Widget {',
				'  render(): void {}',
				'  label = "widget";',
				'}',
				'export interface Point { x: number; y: number; }',
				'export const answer = 42;',
				'enum Color { Red, Green }',
				'export type Id = string;'
			].join('\n')
		);

		const program = createProgramForFiles([filePath]);
		const sourceFile = program.getSourceFile(filePath);
		assert.ok(sourceFile);

		const extracted = extractFile(program, sourceFile!);

		const byName = (name: string) => extracted.symbols.find((s) => s.name === name);

		assert.strictEqual(byName('greet')?.kind, 'function');
		assert.strictEqual(byName('greet')?.exported, true);

		assert.strictEqual(byName('Widget')?.kind, 'class');
		assert.strictEqual(byName('Widget')?.exported, false);

		assert.strictEqual(byName('render')?.kind, 'method');
		assert.strictEqual(byName('render')?.parentName, 'Widget');

		assert.strictEqual(byName('label')?.kind, 'property');

		assert.strictEqual(byName('Point')?.kind, 'interface');
		assert.strictEqual(byName('Point')?.exported, true);

		assert.strictEqual(byName('answer')?.kind, 'variable');
		assert.strictEqual(byName('answer')?.exported, true);

		assert.strictEqual(byName('Color')?.kind, 'enum');
		assert.strictEqual(byName('Color')?.exported, false);

		assert.strictEqual(byName('Id')?.kind, 'typeAlias');
		assert.strictEqual(byName('Id')?.exported, true);
	});

	test('extracts ES import declarations with named, default, and namespace bindings', () => {
		const filePath = writeTempFile(
			tmpDir,
			'imports.ts',
			[
				"import defaultExport from './a';",
				"import * as ns from './b';",
				"import { one, two as twoAlias } from './c';",
				"import './side-effect';"
			].join('\n')
		);

		const program = createProgramForFiles([filePath]);
		const sourceFile = program.getSourceFile(filePath);
		const extracted = extractFile(program, sourceFile!);

		assert.strictEqual(extracted.imports.length, 4);

		const byModule = (specifier: string) =>
			extracted.imports.find((i) => i.moduleSpecifier === specifier);

		assert.deepStrictEqual(byModule('./a')?.importedNames, ['default']);
		assert.deepStrictEqual(byModule('./b')?.importedNames, ['*']);
		assert.deepStrictEqual(byModule('./c')?.importedNames, ['one', 'twoAlias']);
		assert.deepStrictEqual(byModule('./side-effect')?.importedNames, []);
	});

	test('extracts CommonJS require() calls as imports', () => {
		const filePath = writeTempFile(tmpDir, 'require.js', "const fs = require('fs');\n");

		const program = createProgramForFiles([filePath]);
		const sourceFile = program.getSourceFile(filePath);
		const extracted = extractFile(program, sourceFile!);

		assert.strictEqual(extracted.imports.length, 1);
		assert.strictEqual(extracted.imports[0].moduleSpecifier, 'fs');
		assert.strictEqual(extracted.imports[0].isRequire, true);
	});

	test('extracts re-export declarations', () => {
		const filePath = writeTempFile(
			tmpDir,
			'reexport.ts',
			"export { helper } from './utils';\nexport * from './constants';\n"
		);

		const program = createProgramForFiles([filePath]);
		const sourceFile = program.getSourceFile(filePath);
		const extracted = extractFile(program, sourceFile!);

		assert.deepStrictEqual(
			extracted.exports.map((e) => ({ name: e.name, fromModule: e.fromModule })),
			[
				{ name: 'helper', fromModule: './utils' },
				{ name: '*', fromModule: './constants' }
			]
		);
	});

	test('extracts calls from a function body, resolved to the callee declaration with line and order metadata', () => {
		const filePath = writeTempFile(
			tmpDir,
			'calls.ts',
			[
				'function helper(): void {}',
				'function other(): void {}',
				'function run(): void {',
				'  helper();',
				'  other();',
				'}'
			].join('\n')
		);

		const program = createProgramForFiles([filePath]);
		const sourceFile = program.getSourceFile(filePath);
		const extracted = extractFile(program, sourceFile!);

		const calls = extracted.relations.filter((r) => r.kind === 'calls');
		assert.strictEqual(calls.length, 2);

		assert.strictEqual(calls[0].from.name, 'run');
		assert.strictEqual(calls[0].target.name, 'helper');
		assert.strictEqual(calls[0].metadata?.order, 0);
		assert.strictEqual(calls[1].target.name, 'other');
		assert.strictEqual(calls[1].metadata?.order, 1);
		assert.ok(typeof calls[0].metadata?.line === 'number');
	});

	test('extracts calls from a method body, including calls made through this', () => {
		const filePath = writeTempFile(
			tmpDir,
			'method-calls.ts',
			['class Widget {', '  render(): void { this.helper(); }', '  helper(): void {}', '}'].join('\n')
		);

		const program = createProgramForFiles([filePath]);
		const sourceFile = program.getSourceFile(filePath);
		const extracted = extractFile(program, sourceFile!);

		const calls = extracted.relations.filter((r) => r.kind === 'calls');
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].from.name, 'render');
		assert.strictEqual(calls[0].target.name, 'helper');
	});

	test('extracts instantiates relations from new expressions', () => {
		const filePath = writeTempFile(
			tmpDir,
			'instantiate.ts',
			['class Engine {}', 'function build(): void {', '  new Engine();', '}'].join('\n')
		);

		const program = createProgramForFiles([filePath]);
		const sourceFile = program.getSourceFile(filePath);
		const extracted = extractFile(program, sourceFile!);

		const instantiations = extracted.relations.filter((r) => r.kind === 'instantiates');
		assert.strictEqual(instantiations.length, 1);
		assert.strictEqual(instantiations[0].from.name, 'build');
		assert.strictEqual(instantiations[0].target.name, 'Engine');
	});

	test('extracts extends and implements relations between classes/interfaces', () => {
		const filePath = writeTempFile(
			tmpDir,
			'heritage.ts',
			[
				'interface Shape {}',
				'class Base {}',
				'class Circle extends Base implements Shape {}',
				'interface Named extends Shape {}'
			].join('\n')
		);

		const program = createProgramForFiles([filePath]);
		const sourceFile = program.getSourceFile(filePath);
		const extracted = extractFile(program, sourceFile!);

		const extendsRelations = extracted.relations.filter((r) => r.kind === 'extends');
		const implementsRelations = extracted.relations.filter((r) => r.kind === 'implements');

		assert.ok(extendsRelations.some((r) => r.from.name === 'Circle' && r.target.name === 'Base'));
		assert.ok(extendsRelations.some((r) => r.from.name === 'Named' && r.target.name === 'Shape'));
		assert.ok(implementsRelations.some((r) => r.from.name === 'Circle' && r.target.name === 'Shape'));
	});

	test('discards a dynamically-dispatched call it cannot resolve to a specific declaration', () => {
		const filePath = writeTempFile(
			tmpDir,
			'unresolvable.ts',
			['function run(handlers: Record<string, () => void>, key: string): void {', '  handlers[key]();', '}'].join('\n')
		);

		const program = createProgramForFiles([filePath]);
		const sourceFile = program.getSourceFile(filePath);
		const extracted = extractFile(program, sourceFile!);

		const calls = extracted.relations.filter((r) => r.kind === 'calls');
		assert.strictEqual(calls.length, 0, 'expected the dynamically-dispatched call to be discarded, not guessed at');
	});

	test('resolves named import bindings to their declaration, following aliases', () => {
		const utilFile = writeTempFile(tmpDir, 'util.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		const filePath = writeTempFile(tmpDir, 'consumer.ts', "import { add as sum } from './util';\n");

		const program = createProgramForFiles([utilFile, filePath]);
		const sourceFile = program.getSourceFile(filePath);
		const extracted = extractFile(program, sourceFile!);

		assert.strictEqual(extracted.imports.length, 1);
		assert.strictEqual(extracted.imports[0].resolvedSymbols.length, 1);
		assert.strictEqual(extracted.imports[0].resolvedSymbols[0].name, 'add');
		assert.ok(extracted.imports[0].resolvedSymbols[0].filePath.endsWith('util.ts'));
	});
});
