import { CodeGraph } from '../model';
import { extractProgram } from './extractor';
import { findSourceFiles } from './files';
import { normalizeToGraph } from './normalize';
import { createProgramForFiles, getSourceFilesOf } from './program';

export * from './extractor';
export * from './files';
export * from './normalize';
export * from './program';

export interface RunTsPipelineOptions {
	/** Explicit file list to analyze. When omitted, `rootDir` is walked for TS/JS source files. */
	files?: string[];
}

/**
 * Runs the full TS/JS extraction pipeline over a workspace folder: discovers
 * source files, builds a TypeScript Compiler API program, extracts files,
 * symbols, and imports, and normalizes the result into the common graph
 * model.
 */
export function runTsPipeline(rootDir: string, options: RunTsPipelineOptions = {}): CodeGraph {
	const fileNames = options.files ?? findSourceFiles(rootDir);
	if (fileNames.length === 0) {
		return { nodes: [], edges: [] };
	}

	const program = createProgramForFiles(fileNames);
	const sourceFiles = getSourceFilesOf(program, fileNames);
	const extractedFiles = extractProgram(program, sourceFiles);

	return normalizeToGraph(program, extractedFiles);
}
