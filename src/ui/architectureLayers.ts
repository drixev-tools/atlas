// Host-side data prep for the "Open Architecture" view's layered mode
// (./graphPanel): aggregates the Project Graph into folder-derived groups
// (../core/moduleAggregation) with metrics attached (../core/diagramMetrics),
// resolves each group's display label — a Claude-generated name/description
// when available, cached in the Project Graph Core (`ProjectGraphStore`'s
// `getLayerSummary`/`setLayerSummary`) and refreshed only when its member
// file set actually changed, falling back to the plain folder name
// otherwise. Kept free of any `vscode`/React Flow dependency, like
// ./graphFilter and ./graphFocus, so it can be unit tested directly.
import * as crypto from 'crypto';
import { DiagramModel } from '../core/diagramModel';
import { attachDiagramMetrics, computeDiagramMetrics } from '../core/diagramMetrics';
import { EntryPoint, detectEntryPoints } from '../core/entryPoints';
import { aggregateDiagramModelByFile, aggregateDiagramModelByFolder } from '../core/moduleAggregation';
import { ProjectGraphStore, StoredGraph } from '../core/store';
import { LayerNamingResult, LayerNamingTarget } from '../design/layerNamingClient';

/**
 * How many folder levels below the workspace root become their own group.
 * 2 lets a typical `src/<layer>/<module>` project surface both its top-level
 * layers and their immediate submodules as nested groups (see
 * `aggregateDiagramModelByFolder`'s own `parentId` chaining), without going
 * deep enough to turn into a full file tree.
 */
export const ARCHITECTURE_LAYER_DEPTH = 2;

export interface ArchitectureLayerGroup {
	groupId: string;
	folderLabel: string;
	filePaths: string[];
}

export interface ArchitectureLayerData {
	model: DiagramModel;
	/** Every group with an entry in `filePathsByNodeId` — i.e. one with metrics and thus a real folder of files behind it, as opposed to a group that exists only to nest other groups. */
	groups: ArchitectureLayerGroup[];
	/** Ids of every `model` node — a folder group or a root-level file node alike — with a detected entry point among its files. */
	entryPointGroupIds: string[];
}

/** The folder/module-aggregated `DiagramModel` for the architecture view's default "layers" level, with metrics and entry-point group ids attached. */
export function buildArchitectureLayerData(
	store: ProjectGraphStore,
	graph: StoredGraph,
	rootDir: string | undefined,
	changedFiles?: readonly string[]
): ArchitectureLayerData {
	const { model, filePathsByNodeId } = aggregateDiagramModelByFolder(graph, { rootDir, depth: ARCHITECTURE_LAYER_DEPTH });
	const metricsByNodeId = computeDiagramMetrics(store, graph, model, filePathsByNodeId, { changedFiles });

	/** Only real folder groups — a root-level file also gets a `filePathsByNodeId` entry (for its own metrics), but it's a leaf node to open in the Entry Point Flow view, not a group to expand. */
	const groups: ArchitectureLayerGroup[] = model.nodes
		.filter((node) => node.kind === 'group' && filePathsByNodeId.has(node.id))
		.map((node) => ({ groupId: node.id, folderLabel: node.label, filePaths: [...(filePathsByNodeId.get(node.id) ?? [])] }));

	const entryPointFilePaths = toEntryPointFilePathSet(detectEntryPoints(store));
	const entryPointGroupIds = model.nodes
		.filter((node) => (filePathsByNodeId.get(node.id) ?? []).some((filePath) => entryPointFilePaths.has(filePath)))
		.map((node) => node.id);

	return { model: attachDiagramMetrics(model, metricsByNodeId), groups, entryPointGroupIds };
}

export interface ArchitectureFileLevelData {
	model: DiagramModel;
	entryPointFileIds: string[];
}

/** The file-level `DiagramModel` for the architecture view's "files" drill-down into one group, restricted to `group`'s own member files, with metrics and entry-point file ids attached. */
export function buildArchitectureFileLevelData(
	store: ProjectGraphStore,
	graph: StoredGraph,
	group: ArchitectureLayerGroup,
	changedFiles?: readonly string[]
): ArchitectureFileLevelData {
	const filePaths = new Set(group.filePaths);
	const { model, filePathsByNodeId } = aggregateDiagramModelByFile(graph, filePaths);
	const metricsByNodeId = computeDiagramMetrics(store, graph, model, filePathsByNodeId, { changedFiles });

	const entryPointFilePaths = toEntryPointFilePathSet(detectEntryPoints(store));
	const entryPointFileIds = model.nodes.filter((node) => node.filePath && entryPointFilePaths.has(node.filePath)).map((node) => node.id);

	return { model: attachDiagramMetrics(model, metricsByNodeId), entryPointFileIds };
}

function toEntryPointFilePathSet(entryPoints: readonly EntryPoint[]): Set<string> {
	return new Set(entryPoints.map((entryPoint) => entryPoint.filePath).filter((filePath): filePath is string => Boolean(filePath)));
}

/** Deterministic fingerprint of a group's member file set, used to tell a cached label is still valid without re-asking Claude for it. */
export function hashMemberFilePaths(filePaths: readonly string[]): string {
	return crypto.createHash('sha1').update([...filePaths].sort().join('\n')).digest('hex');
}

export interface ArchitectureLayerLabel {
	label: string;
	description: string;
	aiGenerated: boolean;
}

export interface ResolvedLayerLabels {
	labelsByGroupId: Map<string, ArchitectureLayerLabel>;
	/** Groups whose cached label is missing or stale (its file set changed since it was generated) — candidates for a fresh Claude call. */
	staleGroups: ArchitectureLayerGroup[];
}

/**
 * Immediate, synchronous label for every group: its cached Claude-generated
 * name/description when the cache is present and still matches the group's
 * current file set, its plain folder name otherwise. Never calls Claude
 * itself — `refreshStaleLayerLabels` does, for whatever this returns as
 * `staleGroups`, so the architecture view can render instantly with folder
 * names and upgrade them in place once Claude responds.
 */
export function resolveCachedLayerLabels(store: ProjectGraphStore, groups: readonly ArchitectureLayerGroup[]): ResolvedLayerLabels {
	const labelsByGroupId = new Map<string, ArchitectureLayerLabel>();
	const staleGroups: ArchitectureLayerGroup[] = [];

	for (const group of groups) {
		const hash = hashMemberFilePaths(group.filePaths);
		const cached = store.getLayerSummary(group.groupId);
		if (cached && cached.membersHash === hash) {
			labelsByGroupId.set(group.groupId, { label: cached.label, description: cached.description, aiGenerated: true });
			continue;
		}
		labelsByGroupId.set(group.groupId, cached
			? { label: cached.label, description: cached.description, aiGenerated: true }
			: { label: group.folderLabel, description: '', aiGenerated: false });
		staleGroups.push(group);
	}

	return { labelsByGroupId, staleGroups };
}

/** Builds what `ClaudeLayerNamingClient.nameLayers` needs for `groups`, e.g. `staleGroups` from `resolveCachedLayerLabels`. */
export function toLayerNamingTargets(graph: StoredGraph, groups: readonly ArchitectureLayerGroup[]): LayerNamingTarget[] {
	const symbolCountByFilePath = new Map<string, number>();
	for (const node of graph.nodes) {
		if (node.kind !== 'file' && node.filePath) {
			symbolCountByFilePath.set(node.filePath, (symbolCountByFilePath.get(node.filePath) ?? 0) + 1);
		}
	}

	return groups.map((group) => ({
		groupId: group.groupId,
		folderLabel: group.folderLabel,
		fileNames: group.filePaths.map((filePath) => filePath.split(/[\\/]/).pop() ?? filePath),
		symbolCount: group.filePaths.reduce((total, filePath) => total + (symbolCountByFilePath.get(filePath) ?? 0), 0)
	}));
}

/**
 * Persists a fresh Claude naming pass into the cache (one row per named
 * group, keyed by its current file-set hash) and returns just the patch a
 * caller should push to an already-open view — groups Claude didn't return
 * an entry for keep whatever `resolveCachedLayerLabels` already gave them.
 */
export function applyLayerNamingResults(
	store: ProjectGraphStore,
	groups: readonly ArchitectureLayerGroup[],
	results: readonly LayerNamingResult[]
): Map<string, ArchitectureLayerLabel> {
	const groupById = new Map(groups.map((group) => [group.groupId, group] as const));
	const patch = new Map<string, ArchitectureLayerLabel>();

	for (const result of results) {
		const group = groupById.get(result.groupId);
		if (!group) {
			continue;
		}
		const membersHash = hashMemberFilePaths(group.filePaths);
		store.setLayerSummary(group.groupId, { label: result.label, description: result.description, membersHash });
		patch.set(result.groupId, { label: result.label, description: result.description, aiGenerated: true });
	}

	return patch;
}
