import { CodeGraph, createEmptyGraph } from '../model';
import { extractFiles } from './extractor';
import { findSourceFiles } from './files';
import { normalizeToGraph } from './normalize';
import { PythonServer, PythonServerOptions } from './server';

export * from './extractor';
export * from './files';
export * from './normalize';
export * from './protocol';
export * from './server';

export interface RunPythonPipelineOptions {
	/** Explicit file list to analyze. When omitted, `rootDir` is walked for Python source files. */
	files?: string[];
	/**
	 * Absolute paths of every source file known to belong to the project.
	 * Only needed when `files` is a subset of the project (e.g. a single
	 * changed file for an incremental update, Epic 5) so imports to sibling
	 * files not in `files` still resolve to their file node instead of an
	 * external-module node. Defaults to `files` itself.
	 */
	knownFiles?: string[];
	/** Reuse an already-running server instead of starting/stopping a new one for this call. */
	server?: PythonServer;
	serverOptions?: PythonServerOptions;
}

/**
 * Runs the full Python extraction pipeline over a workspace folder: discovers
 * source files, extracts files, symbols, and imports via the persistent
 * `ast`-based server, and normalizes the result into the common graph model.
 *
 * When no `server` is passed, a server is started for this call and stopped
 * afterwards. Callers that want to keep the interpreter warm across multiple
 * runs (e.g. incremental updates in a later epic) should create and own a
 * `PythonServer` and pass it in.
 */
export async function runPythonPipeline(
	rootDir: string,
	options: RunPythonPipelineOptions = {}
): Promise<CodeGraph> {
	const fileNames = options.files ?? findSourceFiles(rootDir);
	if (fileNames.length === 0) {
		return createEmptyGraph();
	}

	const server = options.server ?? new PythonServer(options.serverOptions);
	const ownsServer = !options.server;

	try {
		await server.start();
		const { files } = await extractFiles(server, fileNames);
		return normalizeToGraph(files, rootDir, { knownFilePaths: options.knownFiles });
	} finally {
		if (ownsServer) {
			await server.stop();
		}
	}
}
