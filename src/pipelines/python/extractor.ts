import { PythonServer } from './server';

export type ExtractedSymbolKind = 'function' | 'class' | 'method' | 'property' | 'variable';

export interface ExtractedRange {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export interface ExtractedSymbol {
	kind: ExtractedSymbolKind;
	name: string;
	exported: boolean;
	range: ExtractedRange;
	/** Name of the enclosing class, for methods and properties. */
	parentName?: string;
}

export interface ExtractedImport {
	/** Dotted module path, e.g. `pkg.sub`. Empty string for `from . import x`. */
	moduleSpecifier: string;
	/** Names pulled in by this import, or `['*']` for a whole-module/namespace/star import. */
	importedNames: string[];
	isRelative: boolean;
	/** Number of leading dots in a relative import (`from . import x` -> 1, `from .. import x` -> 2). Always 0 for absolute imports. */
	relativeLevel: number;
	range: ExtractedRange;
}

export interface ExtractedFile {
	filePath: string;
	language: 'python';
	symbols: ExtractedSymbol[];
	imports: ExtractedImport[];
}

export interface ExtractionError {
	filePath: string;
	message: string;
}

export interface ExtractResult {
	files: ExtractedFile[];
	errors: ExtractionError[];
}

/**
 * Asks the persistent Python server to parse the given files with `ast` and
 * return their symbols and imports. Files with syntax errors are skipped and
 * reported in `errors` rather than failing the whole batch.
 */
export async function extractFiles(server: PythonServer, filePaths: string[]): Promise<ExtractResult> {
	if (filePaths.length === 0) {
		return { files: [], errors: [] };
	}
	return server.request<ExtractResult>('extract', { files: filePaths });
}
