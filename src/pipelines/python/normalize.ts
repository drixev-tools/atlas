import * as path from 'path';
import { CodeGraph, GraphEdge, GraphNode, NodeKind, createEmptyGraph } from '../model';
import { ExtractedFile, ExtractedRange, ExtractedRelationTarget, ExtractedSymbol } from './extractor';

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

function externalNodeId(name: string): string {
	return `external:${name}`;
}

function symbolNodeId(fileId: string, range: Pick<ExtractedRange, 'startLine' | 'startColumn'>, name: string): string {
	return `symbol:${fileId}:${range.startLine}:${range.startColumn}:${name}`;
}

function symbolKindToNodeKind(kind: ExtractedSymbol['kind']): NodeKind {
	return kind;
}

function candidateFilePaths(basePath: string): string[] {
	return [`${basePath}.py`, path.join(basePath, '__init__.py')];
}

function findKnownFile(candidates: string[], knownFileIds: Set<string>): string | undefined {
	for (const candidate of candidates) {
		const id = fileNodeId(candidate);
		if (knownFileIds.has(id)) {
			return id;
		}
	}
	return undefined;
}

/** Resolves `import pkg.sub` / `from pkg.sub import x` against the workspace root. */
function resolveAbsoluteModule(moduleSpecifier: string, rootDir: string, knownFileIds: Set<string>): string | undefined {
	if (!moduleSpecifier) {
		return undefined;
	}
	const relativePath = moduleSpecifier.split('.').join(path.sep);
	return findKnownFile(candidateFilePaths(path.join(rootDir, relativePath)), knownFileIds);
}

interface ModuleRef {
	moduleSpecifier: string;
	isRelative: boolean;
	relativeLevel: number;
}

/** Resolves `from . import x` / `from .sub import y` / `from ..pkg import z` relative to the importing file's package. */
function resolveRelativeModule(ref: ModuleRef, containingFilePath: string, knownFileIds: Set<string>): string | undefined {
	let packageDir = path.dirname(containingFilePath);
	for (let i = 1; i < ref.relativeLevel; i++) {
		packageDir = path.dirname(packageDir);
	}

	if (!ref.moduleSpecifier) {
		return findKnownFile([path.join(packageDir, '__init__.py')], knownFileIds);
	}

	const relativePath = ref.moduleSpecifier.split('.').join(path.sep);
	return findKnownFile(candidateFilePaths(path.join(packageDir, relativePath)), knownFileIds);
}

function resolveModuleFileId(ref: ModuleRef, containingFilePath: string, rootDir: string, knownFileIds: Set<string>): string | undefined {
	return ref.isRelative
		? resolveRelativeModule(ref, containingFilePath, knownFileIds)
		: resolveAbsoluteModule(ref.moduleSpecifier, rootDir, knownFileIds);
}

interface ModuleResolution {
	/** Set when the import resolves to a file already in this graph. */
	nodeId?: string;
	/** Set when the import could not be resolved to a project file (stdlib, third-party package, or unresolved relative import). */
	externalName?: string;
}

function resolveModule(ref: ModuleRef, containingFilePath: string, rootDir: string, knownFileIds: Set<string>): ModuleResolution {
	const nodeId = resolveModuleFileId(ref, containingFilePath, rootDir, knownFileIds);
	if (nodeId) {
		return { nodeId };
	}

	const externalName = ref.isRelative ? `${'.'.repeat(ref.relativeLevel)}${ref.moduleSpecifier}` : ref.moduleSpecifier;
	return { externalName };
}

/**
 * Resolves a `calls`/`extends` relation target to the graph node id it
 * corresponds to. A `local` target already carries the exact range of the
 * matching symbol in the same file (server.py found it via `ast`, not a type
 * checker), so it only needs to be checked against that file's own extracted
 * symbols. An `import` target only names a module specifier and a top-level
 * name; it can only be resolved when the target file was itself extracted in
 * this batch, since that is the only place its top-level symbol ids are
 * known without re-parsing it. Anything else (a target file outside the
 * batch, or a name not found among its top-level symbols) is left
 * unresolved rather than guessed at.
 */
function resolveRelationTarget(
	target: ExtractedRelationTarget,
	fileId: string,
	filePath: string,
	rootDir: string,
	batchFileIds: ReadonlySet<string>,
	knownFileIds: Set<string>,
	knownSymbolIds: ReadonlySet<string>,
	topLevelSymbolIdsByFileId: ReadonlyMap<string, Map<string, string>>
): string | undefined {
	if (target.type === 'local') {
		const candidateId = symbolNodeId(fileId, target.range, target.name);
		return knownSymbolIds.has(candidateId) ? candidateId : undefined;
	}

	const targetFileId = resolveModuleFileId(target, filePath, rootDir, knownFileIds);
	if (!targetFileId || !batchFileIds.has(targetFileId)) {
		return undefined;
	}
	return topLevelSymbolIdsByFileId.get(targetFileId)?.get(target.name);
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
 * Converts the intermediate Python extraction result into the
 * pipeline-agnostic graph model, resolving absolute and relative imports to
 * sibling file nodes when they point at a file within `rootDir`, and
 * collapsing everything else — stdlib, third-party packages, unresolvable
 * specifiers — into shared external-module nodes. Also turns each file's
 * already-resolved `calls`/`extends` relations into edges. Mirrors
 * `pipelines/ts/normalize.ts` so both pipelines produce the same shape.
 */
export function normalizeToGraph(
	files: ExtractedFile[],
	rootDir: string,
	options: NormalizeToGraphOptions = {}
): CodeGraph {
	const graph = createEmptyGraph();
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

	const ensureExternalNode = (name: string): string => {
		const id = externalNodeId(name);
		if (!externalNodeIds.has(id)) {
			externalNodeIds.add(id);
			addNode({ id, kind: 'externalModule', name });
		}
		return id;
	};

	const batchFileIds = new Set(files.map((f) => fileNodeId(f.filePath)));
	const knownSymbolIds = new Set<string>();
	const topLevelSymbolIdsByFileId = new Map<string, Map<string, string>>();

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

		topLevelSymbolIdsByFileId.set(fileId, symbolIdByName);
	}

	for (const file of files) {
		const fileId = fileNodeId(file.filePath);

		for (const imp of file.imports) {
			const resolution = resolveModule(imp, file.filePath, rootDir, knownFileIds);
			const targetId = resolution.nodeId ?? ensureExternalNode(resolution.externalName!);

			addEdge({
				id: `imports:${fileId}:${targetId}:${imp.range.startLine}:${imp.range.startColumn}`,
				kind: 'imports',
				source: fileId,
				target: targetId,
				metadata: {
					moduleSpecifier: imp.moduleSpecifier,
					importedNames: imp.importedNames,
					isRelative: imp.isRelative,
					relativeLevel: imp.relativeLevel
				}
			});
		}

		for (const relation of file.relations) {
			const fromId = symbolNodeId(fileId, relation.from.range, relation.from.name);
			const targetId = resolveRelationTarget(
				relation.target,
				fileId,
				file.filePath,
				rootDir,
				batchFileIds,
				knownFileIds,
				knownSymbolIds,
				topLevelSymbolIdsByFileId
			);
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
