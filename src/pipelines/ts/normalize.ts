import * as path from 'path';
import * as ts from 'typescript';
import { CodeGraph, GraphEdge, GraphNode, NodeKind, createEmptyGraph } from '../model';
import { ExtractedDeclarationRef, ExtractedFile, ExtractedRange, ExtractedSymbol } from './extractor';
import { createCompilerOptionsResolver } from './program';

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

function externalNodeId(moduleSpecifier: string): string {
	return `external:${moduleSpecifier}`;
}

function symbolNodeId(fileId: string, range: Pick<ExtractedRange, 'startLine' | 'startColumn'>, name: string): string {
	return `symbol:${fileId}:${range.startLine}:${range.startColumn}:${name}`;
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
	 * changed file re-parsed for an incremental update — still resolve
	 * imports to sibling file nodes it isn't re-parsing this run, instead of
	 * misclassifying them as external modules.
	 */
	knownFilePaths?: string[];
}

/**
 * Resolves a declaration the type checker pointed to (from a call, heritage
 * clause, or import binding) to the graph node id it corresponds to.
 *
 * When the declaring file is part of this extraction batch (`batchFileIds`),
 * the target must match one of that file's own extracted symbols exactly —
 * anything else (a resolution into a declaration kind extraction doesn't
 * track, e.g. a parameter) is discarded rather than guessed at.
 *
 * When the declaring file is only known from a prior run (`knownFileIds` but
 * not `batchFileIds` — the incremental single-file case), that file's own
 * symbols were never re-extracted this run, so there is nothing to check the
 * target against; it is trusted the same way a plain file-to-file import
 * already trusts `knownFileIds` without re-verifying the target file's
 * contents.
 */
function resolveDeclarationRefTarget(
	target: ExtractedDeclarationRef,
	batchFileIds: ReadonlySet<string>,
	knownFileIds: ReadonlySet<string>,
	knownSymbolIds: ReadonlySet<string>
): string | undefined {
	const targetFileId = fileNodeId(target.filePath);
	if (!knownFileIds.has(targetFileId)) {
		return undefined;
	}

	const targetSymbolId = symbolNodeId(targetFileId, target.range, target.name);
	if (batchFileIds.has(targetFileId)) {
		return knownSymbolIds.has(targetSymbolId) ? targetSymbolId : undefined;
	}
	return targetSymbolId;
}

/**
 * Converts the intermediate TS/JS extraction result into the pipeline-agnostic
 * graph model, resolving relative imports to sibling file nodes (via the TS
 * module resolution algorithm) and collapsing everything else — packages,
 * unresolvable specifiers — into shared external-module nodes.
 */
export function normalizeToGraph(files: ExtractedFile[], rootDir: string, options: NormalizeToGraphOptions = {}): CodeGraph {
	const graph = createEmptyGraph();
	const batchFileIds = new Set(files.map((f) => fileNodeId(f.filePath)));
	const knownFileIds = new Set([...batchFileIds, ...(options.knownFilePaths ?? []).map(fileNodeId)]);
	const externalNodeIds = new Set<string>();

	/**
	 * Per-file compiler options, from that file's nearest `tsconfig.json`
	 * (found within `rootDir`) — a monorepo can have a different
	 * `tsconfig.json` (different `paths` aliases) per package, so module
	 * resolution needs to use the config that actually applies to the
	 * importing file, not one global config for everything. Shared with
	 * `./program`'s own Program construction
	 * (`createProgramForFilesWithPathMapping`) so the type checker behind
	 * `calls`/`extends`/`instantiates` resolution agrees with this
	 * file-to-file `imports` resolution about which aliases apply to a given
	 * file.
	 */
	const compilerOptionsForFile = createCompilerOptionsResolver(rootDir);

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

	const knownSymbolIds = new Set<string>();

	for (const file of files) {
		const fileId = fileNodeId(file.filePath);
		addNode({
			id: fileId,
			kind: 'file',
			name: path.basename(file.filePath),
			filePath: file.filePath,
			language: file.language
		});

		const symbolIdByName = new Map<string, string>();

		for (const symbol of file.symbols) {
			const symbolId = symbolNodeId(fileId, symbol.range, symbol.name);
			knownSymbolIds.add(symbolId);
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
	}

	for (const file of files) {
		const fileId = fileNodeId(file.filePath);
		const fileCompilerOptions = compilerOptionsForFile(file.filePath);

		for (const imp of file.imports) {
			const resolution = resolveModuleSpecifier(imp.moduleSpecifier, file.filePath, fileCompilerOptions, knownFileIds);
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

			for (const resolvedSymbol of imp.resolvedSymbols) {
				const targetSymbolId = resolveDeclarationRefTarget(resolvedSymbol, batchFileIds, knownFileIds, knownSymbolIds);
				if (!targetSymbolId) {
					continue;
				}
				addEdge({
					id: `imports:${fileId}:${targetSymbolId}`,
					kind: 'imports',
					source: fileId,
					target: targetSymbolId,
					metadata: { name: resolvedSymbol.name, moduleSpecifier: imp.moduleSpecifier }
				});
			}
		}

		for (const exp of file.exports) {
			if (!exp.fromModule) {
				continue;
			}
			const resolution = resolveModuleSpecifier(exp.fromModule, file.filePath, fileCompilerOptions, knownFileIds);
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

		for (const relation of file.relations) {
			const fromId = symbolNodeId(fileId, relation.from.range, relation.from.name);
			const targetId = resolveDeclarationRefTarget(relation.target, batchFileIds, knownFileIds, knownSymbolIds);
			if (!targetId || fromId === targetId) {
				continue;
			}

			const order = relation.metadata?.order;
			const idSuffix = typeof order === 'number' ? `:${order}` : '';
			addEdge({
				id: `${relation.kind}:${fromId}:${targetId}${idSuffix}`,
				kind: relation.kind,
				source: fromId,
				target: targetId,
				metadata: relation.metadata
			});
		}
	}

	return graph;
}
