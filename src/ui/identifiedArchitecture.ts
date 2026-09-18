// Host-side data prep for the "Identified Architecture" view
// (./identifiedArchitecturePanel): a second, separate diagram from "Open
// Architecture" (../architectureLayers) where Claude names the project's real
// architecture pattern and assigns each real folder module an architectural
// role, regrouping those same modules under role groups instead of their
// folder — mirroring how ../design/proposedGraph.ts turns Claude's structured
// response into a graph, but in reverse: analyzing the already-extracted real
// graph instead of proposing a new one. Cached in the Project Graph Core like
// ../architectureLayers' layer labels (`ProjectGraphStore`'s
// `getIdentifiedArchitecture`/`setIdentifiedArchitecture`), refreshed only
// when the underlying module set actually changed. Kept free of any
// `vscode`/React Flow dependency, like ../architectureLayers, so it can be
// unit tested directly.
import * as crypto from 'crypto';
import { DiagramEdge, DiagramEdgeKindCount, DiagramModel, DiagramNode } from '../core/diagramModel';
import { ProjectGraphStore, StoredGraph } from '../core/store';
import { EdgeKind } from '../pipelines/model';
import { ArchitectureIdentification, ArchitectureIdentificationEntity, ArchitectureIdentificationRelation } from '../design/architectureIdentificationClient';
import { ArchitectureLayerGroup, buildArchitectureLayerData } from './architectureLayers';

export const SHOW_IDENTIFIED_ARCHITECTURE_COMMAND = 'agentGraph.showIdentifiedArchitecture';

export interface IdentifiedArchitectureEntities {
	groups: ArchitectureLayerGroup[];
	entityNodes: DiagramNode[];
	edges: DiagramEdge[];
}

/**
 * The real, folder-aggregated modules (../architectureLayers's groups — the
 * same granularity "Open Architecture" shows by default) Claude is asked to
 * assign an architectural role to, plus the real edges between them. A
 * root-level loose file (not itself a folder group) is left out: there are
 * usually few of them and they rarely carry architectural signal on their
 * own, matching ../architectureLayers' own `toLayerNamingTargets` scope.
 */
export function identifiedArchitectureEntities(store: ProjectGraphStore, graph: StoredGraph, rootDir: string | undefined): IdentifiedArchitectureEntities {
	const { model, groups } = buildArchitectureLayerData(store, graph, rootDir);
	const groupIds = new Set(groups.map((group) => group.groupId));
	return { groups, entityNodes: model.nodes.filter((node) => groupIds.has(node.id)), edges: model.edges };
}

/** Builds what `ClaudeArchitectureIdentificationClient.identifyArchitecture` needs for `groups`: each module's file names/symbol count plus its dependency relations to other modules, summarized from `edges` — never the source code itself. */
export function toArchitectureIdentificationEntities(
	graph: StoredGraph,
	groups: readonly ArchitectureLayerGroup[],
	edges: readonly DiagramEdge[]
): ArchitectureIdentificationEntity[] {
	const groupIds = new Set(groups.map((group) => group.groupId));
	const labelByGroupId = new Map(groups.map((group) => [group.groupId, group.folderLabel] as const));

	const symbolCountByFilePath = new Map<string, number>();
	for (const node of graph.nodes) {
		if (node.kind !== 'file' && node.filePath) {
			symbolCountByFilePath.set(node.filePath, (symbolCountByFilePath.get(node.filePath) ?? 0) + 1);
		}
	}

	const dependsOnById = new Map<string, Map<string, Set<EdgeKind>>>();
	const dependedOnByById = new Map<string, Map<string, Set<EdgeKind>>>();
	for (const edge of edges) {
		if (!groupIds.has(edge.source) || !groupIds.has(edge.target) || edge.source === edge.target) {
			continue;
		}
		addRelation(dependsOnById, edge.source, edge.target, edge.kinds);
		addRelation(dependedOnByById, edge.target, edge.source, edge.kinds);
	}

	return groups.map((group) => ({
		groupId: group.groupId,
		label: group.folderLabel,
		fileNames: group.filePaths.map((filePath) => filePath.split(/[\\/]/).pop() ?? filePath),
		symbolCount: group.filePaths.reduce((total, filePath) => total + (symbolCountByFilePath.get(filePath) ?? 0), 0),
		dependsOn: toRelationList(dependsOnById.get(group.groupId), labelByGroupId),
		dependedOnBy: toRelationList(dependedOnByById.get(group.groupId), labelByGroupId)
	}));
}

function addRelation(byId: Map<string, Map<string, Set<EdgeKind>>>, fromId: string, toId: string, kinds: readonly DiagramEdgeKindCount[]): void {
	const related = byId.get(fromId) ?? new Map<string, Set<EdgeKind>>();
	const kindSet = related.get(toId) ?? new Set<EdgeKind>();
	for (const entry of kinds) {
		kindSet.add(entry.kind);
	}
	related.set(toId, kindSet);
	byId.set(fromId, related);
}

function toRelationList(related: Map<string, Set<EdgeKind>> | undefined, labelByGroupId: ReadonlyMap<string, string>): ArchitectureIdentificationRelation[] {
	if (!related) {
		return [];
	}
	return [...related.entries()].map(([groupId, kinds]) => ({ label: labelByGroupId.get(groupId) ?? groupId, kinds: [...kinds] }));
}

export interface IdentifiedArchitectureModel {
	model: DiagramModel;
	patternName: string;
	patternDescription: string;
	/** Each role group's one-sentence responsibility, keyed by that role's `DiagramNode.id` — a side channel like ../webview/protocol's `ArchitectureLayerLabel`, since `DiagramNode` itself carries no free-text field. */
	roleDescriptionsByGroupId: Record<string, string>;
}

interface IdentificationLike {
	patternName: string;
	patternDescription: string;
	roles: readonly { role: string; description: string }[];
	assignments: readonly { groupId: string; role: string }[];
}

/**
 * Converts Claude's `identify_architecture` response (or the cached
 * equivalent from `ProjectGraphStore.getIdentifiedArchitecture`) into a
 * `DiagramModel` rooted at one group per distinct role, each containing the
 * real modules (`entityNodes`) assigned to it — the same ref-resolution shape
 * `buildProposedGraph` (../design/proposedGraph) uses, but regrouping
 * existing nodes by an assigned role instead of resolving brand-new ones. An
 * assignment naming an unknown module id or a role missing from `roles`
 * (Claude inventing one, or a corrupted cache row) is silently dropped, like
 * `parseArchitectureIdentification`'s own validation — that module simply
 * doesn't appear in the identified diagram.
 */
export function buildIdentifiedArchitectureModel(
	entityNodes: readonly DiagramNode[],
	edges: readonly DiagramEdge[],
	identification: IdentificationLike
): IdentifiedArchitectureModel {
	const entityById = new Map(entityNodes.map((node) => [node.id, node] as const));
	const roleDefinitionByRole = new Map(identification.roles.map((role) => [role.role, role] as const));

	const roleIdByEntityId = new Map<string, string>();
	const roleGroupsById = new Map<string, DiagramNode>();
	const roleDescriptionsByGroupId: Record<string, string> = {};

	for (const assignment of identification.assignments) {
		const entity = entityById.get(assignment.groupId);
		const roleDefinition = roleDefinitionByRole.get(assignment.role);
		if (!entity || !roleDefinition) {
			continue;
		}
		const roleId = roleGroupNodeId(assignment.role);
		if (!roleGroupsById.has(roleId)) {
			roleGroupsById.set(roleId, { id: roleId, kind: 'group', label: roleDefinition.role });
			roleDescriptionsByGroupId[roleId] = roleDefinition.description;
		}
		roleIdByEntityId.set(entity.id, roleId);
	}

	const nodes: DiagramNode[] = [
		...roleGroupsById.values(),
		...[...roleIdByEntityId.entries()].map(([entityId, roleId]) => ({ ...(entityById.get(entityId) as DiagramNode), parentId: roleId }))
	];

	return {
		model: { nodes, edges: aggregateEdgesByRole(edges, roleIdByEntityId) },
		patternName: identification.patternName,
		patternDescription: identification.patternDescription,
		roleDescriptionsByGroupId
	};
}

type RolePair = { source: string; target: string; kinds: Map<EdgeKind, number> };

/**
 * One `DiagramEdge` per pair of role groups, however many entity-level edges
 * (in either direction) connected their members. Two role groups that depend
 * on each other both ways — common once modules are lumped into a handful of
 * roles, even when no single pair of underlying modules was itself circular —
 * are folded into a single edge (kinds from both directions summed, the
 * heavier direction's source/target kept) instead of two nearly-overlapping
 * arrows drawn on top of each other with their count labels stacked at the
 * same midpoint.
 */
function aggregateEdgesByRole(edges: readonly DiagramEdge[], roleIdByEntityId: ReadonlyMap<string, string>): DiagramEdge[] {
	const pairsByKey = new Map<string, RolePair>();
	for (const edge of edges) {
		const source = roleIdByEntityId.get(edge.source);
		const target = roleIdByEntityId.get(edge.target);
		if (!source || !target || source === target) {
			continue;
		}
		const key = `${source}::${target}`;
		const pair = pairsByKey.get(key) ?? { source, target, kinds: new Map<EdgeKind, number>() };
		for (const entry of edge.kinds) {
			pair.kinds.set(entry.kind, (pair.kinds.get(entry.kind) ?? 0) + entry.count);
		}
		pairsByKey.set(key, pair);
	}

	const merged: RolePair[] = [];
	const consumedKeys = new Set<string>();
	for (const [key, pair] of pairsByKey) {
		if (consumedKeys.has(key)) {
			continue;
		}
		consumedKeys.add(key);
		const reverseKey = `${pair.target}::${pair.source}`;
		const reverse = pairsByKey.get(reverseKey);
		if (!reverse) {
			merged.push(pair);
			continue;
		}
		consumedKeys.add(reverseKey);
		const [primary, secondary] = kindsTotal(pair.kinds) >= kindsTotal(reverse.kinds) ? [pair, reverse] : [reverse, pair];
		const kinds = new Map(primary.kinds);
		for (const [kind, count] of secondary.kinds) {
			kinds.set(kind, (kinds.get(kind) ?? 0) + count);
		}
		merged.push({ source: primary.source, target: primary.target, kinds });
	}

	return merged.map((pair) => ({
		id: `identified-architecture-edge:${pair.source}:${pair.target}`,
		source: pair.source,
		target: pair.target,
		kinds: [...pair.kinds.entries()].map(([kind, count]) => ({ kind, count }))
	}));
}

function kindsTotal(kinds: ReadonlyMap<EdgeKind, number>): number {
	let total = 0;
	for (const count of kinds.values()) {
		total += count;
	}
	return total;
}

function roleGroupNodeId(role: string): string {
	const slug = role
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-+|-+$)/g, '');
	return `identified-role:${slug || 'unclassified'}`;
}

/** Deterministic fingerprint of every candidate module's id and file set, used to tell a cached identification is still valid without re-asking Claude for it, like `hashMemberFilePaths` (../architectureLayers) — but across the whole module set at once, since the role assignment is one joint decision. */
export function hashArchitectureIdentificationEntities(entities: readonly ArchitectureIdentificationEntity[]): string {
	const normalized = [...entities]
		.map((entity) => `${entity.groupId}:${[...entity.fileNames].sort().join(',')}`)
		.sort()
		.join('\n');
	return crypto.createHash('sha1').update(normalized).digest('hex');
}

export interface ResolvedIdentifiedArchitecture {
	model: IdentifiedArchitectureModel | undefined;
	/** Whether the module set has changed since this was generated (or nothing was ever cached) — a candidate for a fresh Claude call. */
	stale: boolean;
}

/** The cached identification for `entities`, converted straight to a `DiagramModel` for an instant render, or `undefined` when nothing has ever been cached — the caller then shows a loading/needs-configuration state instead. Never calls Claude itself. */
export function resolveCachedIdentifiedArchitecture(
	store: ProjectGraphStore,
	entityNodes: readonly DiagramNode[],
	edges: readonly DiagramEdge[],
	entities: readonly ArchitectureIdentificationEntity[]
): ResolvedIdentifiedArchitecture {
	const cached = store.getIdentifiedArchitecture();
	if (!cached) {
		return { model: undefined, stale: true };
	}
	return {
		model: buildIdentifiedArchitectureModel(entityNodes, edges, cached),
		stale: cached.entitiesHash !== hashArchitectureIdentificationEntities(entities)
	};
}

/** Persists a fresh Claude identification into the cache and returns the `DiagramModel` a caller should push to an already-open view. */
export function applyArchitectureIdentification(
	store: ProjectGraphStore,
	entityNodes: readonly DiagramNode[],
	edges: readonly DiagramEdge[],
	entities: readonly ArchitectureIdentificationEntity[],
	identification: ArchitectureIdentification
): IdentifiedArchitectureModel {
	store.setIdentifiedArchitecture({
		patternName: identification.patternName,
		patternDescription: identification.patternDescription,
		roles: identification.roles,
		assignments: identification.assignments,
		entitiesHash: hashArchitectureIdentificationEntities(entities)
	});
	return buildIdentifiedArchitectureModel(entityNodes, edges, identification);
}
