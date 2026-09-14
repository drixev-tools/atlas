import * as path from 'path';
import * as ts from 'typescript';
import { CodeGraph, GraphEdge, GraphNode, NodeKind, createEmptyGraph } from '../model';
import { ExtractedFile, ExtractedSymbol } from './extractor';

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

function externalNodeId(moduleSpecifier: string): string {
	return `external:${moduleSpecifier}`;
}

function symbolKindToNodeKind(kind: ExtractedSymbol['kind']): NodeKind {
	return kind;
}

interface ModuleResolution {
	nodeId: string;
	isExternal: boolean;
}

function resolveModuleSpecifier(
	moduleSpecifier: string,
	containingFilePath: string,
	compilerOptions: ts.CompilerOptions,
	knownFileIds: Set<string>
): ModuleResolution {
	const result = ts.resolveModuleName(moduleSpecifier, containingFilePath, compilerOptions, ts.sys);
	const resolvedFileName = result.resolvedModule?.resolvedFileName;

	if (resolvedFileName) {
		const candidateId = fileNodeId(resolvedFileName);
		if (knownFileIds.has(candidateId)) {
			return { nodeId: candidateId, isExternal: false };
		}
	}

	return { nodeId: externalNodeId(moduleSpecifier), isExternal: true };
}

export interface NormalizeToGraphOptions {
	/**
	 * Absolute paths of every source file known to belong to the project, in
	 * addition to `files` itself. Lets a partial extraction — e.g. a single
	 * changed file re-parsed for an incremental update (Epic 5) — still
	 * resolve imports to sibling file nodes it isn't re-parsing this run,
	 * instead of misclassifying them as external modules.
	 */
	knownFilePaths?: string[];
}

/**
 * Converts the intermediate TS/JS extraction result into the pipeline-agnostic
 * graph model, resolving relative imports to sibling file nodes (via the TS
 * module resolution algorithm) and collapsing everything else — packages,
 * unresolvable specifiers — into shared external-module nodes.
 */
export function normalizeToGraph(
	program: ts.Program,
	files: ExtractedFile[],
	options: NormalizeToGraphOptions = {}
): CodeGraph {
	const graph = createEmptyGraph();
	const compilerOptions = program.getCompilerOptions();
	const knownFileIds = new Set([
		...files.map((f) => fileNodeId(f.filePath)),
		...(options.knownFilePaths ?? []).map(fileNodeId)
	]);
	const externalNodeIds = new Set<string>();

	const addNode = (node: GraphNode): void => {
		graph.nodes.push(node);
	};

	const addEdge = (edge: GraphEdge): void => {
		graph.edges.push(edge);
	};

	const ensureExternalNode = (moduleSpecifier: string): string => {
		const id = externalNodeId(moduleSpecifier);
		if (!externalNodeIds.has(id)) {
			externalNodeIds.add(id);
			addNode({ id, kind: 'externalModule', name: moduleSpecifier });
		}
		return id;
	};

	for (const file of files) {
		const fileId = fileNodeId(file.filePath);
		addNode({
			id: fileId,
			kind: 'file',
			name: path.basename(file.filePath),
			filePath: file.filePath,
			language: file.language
		});

		const symbolIdByDeclaration = new Map<ExtractedSymbol, string>();
		const symbolIdByName = new Map<string, string>();

		for (const symbol of file.symbols) {
			const symbolId = `symbol:${fileId}:${symbol.range.startLine}:${symbol.range.startColumn}:${symbol.name}`;
			symbolIdByDeclaration.set(symbol, symbolId);
			if (!symbol.parentName) {
				symbolIdByName.set(symbol.name, symbolId);
			}

			addNode({
				id: symbolId,
				kind: symbolKindToNodeKind(symbol.kind),
				name: symbol.name,
				filePath: file.filePath,
				exported: symbol.exported,
				range: symbol.range
			});

			const containerId = symbol.parentName ? symbolIdByName.get(symbol.parentName) : fileId;
			if (containerId) {
				addEdge({
					id: `contains:${containerId}:${symbolId}`,
					kind: 'contains',
					source: containerId,
					target: symbolId
				});
			}

			if (!symbol.parentName && symbol.exported) {
				addEdge({
					id: `exports:${fileId}:${symbolId}`,
					kind: 'exports',
					source: fileId,
					target: symbolId
				});
			}
		}

		for (const imp of file.imports) {
			const resolution = resolveModuleSpecifier(
				imp.moduleSpecifier,
				file.filePath,
				compilerOptions,
				knownFileIds
			);
			if (resolution.isExternal) {
				ensureExternalNode(imp.moduleSpecifier);
			}

			addEdge({
				id: `imports:${fileId}:${resolution.nodeId}:${imp.range.startLine}:${imp.range.startColumn}`,
				kind: 'imports',
				source: fileId,
				target: resolution.nodeId,
				metadata: {
					moduleSpecifier: imp.moduleSpecifier,
					importedNames: imp.importedNames,
					isTypeOnly: imp.isTypeOnly,
					isRequire: imp.isRequire
				}
			});
		}

		for (const exp of file.exports) {
			if (!exp.fromModule) {
				continue;
			}
			const resolution = resolveModuleSpecifier(
				exp.fromModule,
				file.filePath,
				compilerOptions,
				knownFileIds
			);
			if (resolution.isExternal) {
				ensureExternalNode(exp.fromModule);
			}

			addEdge({
				id: `exports:${fileId}:${resolution.nodeId}:${exp.name}`,
				kind: 'exports',
				source: fileId,
				target: resolution.nodeId,
				metadata: { name: exp.name, fromModule: exp.fromModule }
			});
		}
	}

	return graph;
}
