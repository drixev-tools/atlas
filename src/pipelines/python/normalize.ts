import * as path from 'path';
import { CodeGraph, GraphEdge, GraphNode, NodeKind, createEmptyGraph } from '../model';
import { ExtractedFile, ExtractedImport, ExtractedSymbol } from './extractor';

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

function externalNodeId(name: string): string {
	return `external:${name}`;
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

/** Resolves `from . import x` / `from .sub import y` / `from ..pkg import z` relative to the importing file's package. */
function resolveRelativeModule(imp: ExtractedImport, containingFilePath: string, knownFileIds: Set<string>): string | undefined {
	let packageDir = path.dirname(containingFilePath);
	for (let i = 1; i < imp.relativeLevel; i++) {
		packageDir = path.dirname(packageDir);
	}

	if (!imp.moduleSpecifier) {
		return findKnownFile([path.join(packageDir, '__init__.py')], knownFileIds);
	}

	const relativePath = imp.moduleSpecifier.split('.').join(path.sep);
	return findKnownFile(candidateFilePaths(path.join(packageDir, relativePath)), knownFileIds);
}

interface ModuleResolution {
	/** Set when the import resolves to a file already in this graph. */
	nodeId?: string;
	/** Set when the import could not be resolved to a project file (stdlib, third-party package, or unresolved relative import). */
	externalName?: string;
}

function resolveModule(
	imp: ExtractedImport,
	containingFilePath: string,
	rootDir: string,
	knownFileIds: Set<string>
): ModuleResolution {
	const nodeId = imp.isRelative
		? resolveRelativeModule(imp, containingFilePath, knownFileIds)
		: resolveAbsoluteModule(imp.moduleSpecifier, rootDir, knownFileIds);

	if (nodeId) {
		return { nodeId };
	}

	const externalName = imp.isRelative ? `${'.'.repeat(imp.relativeLevel)}${imp.moduleSpecifier}` : imp.moduleSpecifier;
	return { externalName };
}

/**
 * Converts the intermediate Python extraction result into the
 * pipeline-agnostic graph model, resolving absolute and relative imports to
 * sibling file nodes when they point at a file within `rootDir`, and
 * collapsing everything else — stdlib, third-party packages, unresolvable
 * specifiers — into shared external-module nodes. Mirrors
 * `pipelines/ts/normalize.ts` so both pipelines produce the same shape.
 */
export function normalizeToGraph(files: ExtractedFile[], rootDir: string): CodeGraph {
	const graph = createEmptyGraph();
	const knownFileIds = new Set(files.map((f) => fileNodeId(f.filePath)));
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
			const symbolId = `symbol:${fileId}:${symbol.range.startLine}:${symbol.range.startColumn}:${symbol.name}`;
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
	}

	return graph;
}
