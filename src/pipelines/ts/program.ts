import * as path from 'path';
import * as ts from 'typescript';

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
	allowJs: true,
	checkJs: false,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ES2022,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	esModuleInterop: true,
	jsx: ts.JsxEmit.Preserve,
	noEmit: true
};

/**
 * Creates a TypeScript Compiler API program covering the given file list.
 * `allowJs` is enabled by default so plain JS/JSX files are parsed with the
 * same program and type checker as TS/TSX files.
 */
export function createProgramForFiles(
	fileNames: string[],
	compilerOptions: ts.CompilerOptions = DEFAULT_COMPILER_OPTIONS
): ts.Program {
	return ts.createProgram({
		rootNames: fileNames,
		options: compilerOptions
	});
}

/**
 * Creates a program from an existing tsconfig.json, falling back to the
 * default options above for anything the config does not specify.
 */
export function createProgramFromTsConfig(tsconfigPath: string): ts.Program {
	const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (configFile.error) {
		throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
	}

	const parsed = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		path.dirname(tsconfigPath)
	);

	return ts.createProgram({
		rootNames: parsed.fileNames,
		options: { ...DEFAULT_COMPILER_OPTIONS, ...parsed.options }
	});
}

export function getSourceFilesOf(program: ts.Program, fileNames: string[]): ts.SourceFile[] {
	const wanted = new Set(fileNames.map((f) => ts.sys.resolvePath(f)));
	return program
		.getSourceFiles()
		.filter((sourceFile) => wanted.has(ts.sys.resolvePath(sourceFile.fileName)));
}

export { DEFAULT_COMPILER_OPTIONS };
