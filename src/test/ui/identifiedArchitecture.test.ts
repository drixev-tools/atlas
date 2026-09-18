import * as assert from 'assert';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { DiagramEdge, DiagramNode } from '../../core/diagramModel';
import { ProjectGraphStore } from '../../core/store';
import {
	applyArchitectureIdentification,
	buildIdentifiedArchitectureModel,
	hashArchitectureIdentificationEntities,
	identifiedArchitectureEntities,
	resolveCachedIdentifiedArchitecture,
	toArchitectureIdentificationEntities
} from '../../ui/identifiedArchitecture';

const ROOT = path.join('project');

function fileNode(relativePath: string): GraphNode {
	return { id: `file:${relativePath}`, kind: 'file', name: path.basename(relativePath), filePath: path.join(ROOT, relativePath) };
}

function symbolNode(id: string, filePath: string, kind: GraphNode['kind'] = 'function'): GraphNode {
	return { id, kind, name: id, filePath };
}

function edge(id: string, kind: GraphEdge['kind'], source: string, target: string): GraphEdge {
	return { id, kind, source, target };
}

suite('buildIdentifiedArchitectureModel', () => {
	const controllerNode: DiagramNode = { id: 'group:controllers', kind: 'group', label: 'controllers' };
	const serviceNode: DiagramNode = { id: 'group:services', kind: 'group', label: 'services' };
	const entityNodes = [controllerNode, serviceNode];

	const relEdge: DiagramEdge = { id: 'e1', source: 'group:controllers', target: 'group:services', kinds: [{ kind: 'calls', count: 2 }] };

	test('nests each assigned module under its role group, dropping DiagramNode.metadata-less role descriptions into a side map', () => {
		const identification = {
			patternName: 'Layered Architecture',
			patternDescription: 'Controllers call services.',
			roles: [
				{ role: 'Controller', description: 'Handles requests.' },
				{ role: 'Service', description: 'Business logic.' }
			],
			assignments: [
				{ groupId: 'group:controllers', role: 'Controller' },
				{ groupId: 'group:services', role: 'Service' }
			]
		};

		const result = buildIdentifiedArchitectureModel(entityNodes, [relEdge], identification);

		const roleGroups = result.model.nodes.filter((node) => !node.parentId);
		assert.strictEqual(roleGroups.length, 2);
		assert.deepStrictEqual(
			roleGroups.map((node) => node.label).sort(),
			['Controller', 'Service']
		);

		const controller = result.model.nodes.find((node) => node.id === 'group:controllers');
		const service = result.model.nodes.find((node) => node.id === 'group:services');
		assert.ok(controller?.parentId);
		assert.ok(service?.parentId);
		assert.notStrictEqual(controller?.parentId, service?.parentId);

		assert.strictEqual(result.roleDescriptionsByGroupId[controller?.parentId as string], 'Handles requests.');
		assert.strictEqual(result.patternName, 'Layered Architecture');
	});

	test('aggregates an edge between two entities onto their role groups, summing kind counts', () => {
		const identification = {
			patternName: 'x',
			patternDescription: 'y',
			roles: [{ role: 'Controller', description: 'a' }, { role: 'Service', description: 'b' }],
			assignments: [
				{ groupId: 'group:controllers', role: 'Controller' },
				{ groupId: 'group:services', role: 'Service' }
			]
		};

		const result = buildIdentifiedArchitectureModel(entityNodes, [relEdge], identification);

		assert.strictEqual(result.model.edges.length, 1);
		assert.deepStrictEqual(result.model.edges[0].kinds, [{ kind: 'calls', count: 2 }]);
	});

	test('drops an edge whose endpoints share the same role (a self-edge once regrouped)', () => {
		const identification = {
			patternName: 'x',
			patternDescription: 'y',
			roles: [{ role: 'Backend', description: 'a' }],
			assignments: [
				{ groupId: 'group:controllers', role: 'Backend' },
				{ groupId: 'group:services', role: 'Backend' }
			]
		};

		const result = buildIdentifiedArchitectureModel(entityNodes, [relEdge], identification);

		assert.strictEqual(result.model.edges.length, 0);
	});

	suite('mutual dependencies between two role groups', () => {
		const identification = {
			patternName: 'x',
			patternDescription: 'y',
			roles: [{ role: 'Controller', description: 'a' }, { role: 'Service', description: 'b' }],
			assignments: [
				{ groupId: 'group:controllers', role: 'Controller' },
				{ groupId: 'group:services', role: 'Service' }
			]
		};

		function build(edges: DiagramEdge[]) {
			const result = buildIdentifiedArchitectureModel(entityNodes, edges, identification);
			const controllerRoleId = result.model.nodes.find((node) => node.id === 'group:controllers')?.parentId as string;
			const serviceRoleId = result.model.nodes.find((node) => node.id === 'group:services')?.parentId as string;
			return { edges: result.model.edges, controllerRoleId, serviceRoleId };
		}

		test('folds both directions into a single edge pointing along the heavier direction', () => {
			const forward: DiagramEdge = { id: 'f', source: 'group:controllers', target: 'group:services', kinds: [{ kind: 'calls', count: 3 }] };
			const backward: DiagramEdge = { id: 'b', source: 'group:services', target: 'group:controllers', kinds: [{ kind: 'calls', count: 1 }] };

			const { edges, controllerRoleId, serviceRoleId } = build([forward, backward]);

			assert.strictEqual(edges.length, 1);
			assert.strictEqual(edges[0].source, controllerRoleId);
			assert.strictEqual(edges[0].target, serviceRoleId);
			assert.deepStrictEqual(edges[0].kinds, [{ kind: 'calls', count: 4 }]);
		});

		test('keeps the heavier direction even when it is the reverse of the first edge seen', () => {
			const light: DiagramEdge = { id: 'l', source: 'group:controllers', target: 'group:services', kinds: [{ kind: 'calls', count: 1 }] };
			const heavy: DiagramEdge = { id: 'h', source: 'group:services', target: 'group:controllers', kinds: [{ kind: 'calls', count: 5 }] };

			const { edges, controllerRoleId, serviceRoleId } = build([light, heavy]);

			assert.strictEqual(edges.length, 1);
			assert.strictEqual(edges[0].source, serviceRoleId);
			assert.strictEqual(edges[0].target, controllerRoleId);
			assert.deepStrictEqual(edges[0].kinds, [{ kind: 'calls', count: 6 }]);
		});

		test('keeps the first-seen direction when both directions weigh the same', () => {
			const forward: DiagramEdge = { id: 'f', source: 'group:controllers', target: 'group:services', kinds: [{ kind: 'calls', count: 2 }] };
			const backward: DiagramEdge = { id: 'b', source: 'group:services', target: 'group:controllers', kinds: [{ kind: 'calls', count: 2 }] };

			const { edges, controllerRoleId, serviceRoleId } = build([forward, backward]);

			assert.strictEqual(edges.length, 1);
			assert.strictEqual(edges[0].source, controllerRoleId);
			assert.strictEqual(edges[0].target, serviceRoleId);
		});

		test('sums counts per kind across directions, keeping kinds that only one direction had', () => {
			const forward: DiagramEdge = { id: 'f', source: 'group:controllers', target: 'group:services', kinds: [{ kind: 'calls', count: 3 }, { kind: 'imports', count: 1 }] };
			const backward: DiagramEdge = { id: 'b', source: 'group:services', target: 'group:controllers', kinds: [{ kind: 'calls', count: 1 }, { kind: 'extends', count: 2 }] };

			const { edges } = build([forward, backward]);

			assert.strictEqual(edges.length, 1);
			const countsByKind = new Map(edges[0].kinds.map((entry) => [entry.kind, entry.count]));
			assert.deepStrictEqual(
				[...countsByKind.entries()].sort(),
				[['calls', 4], ['extends', 2], ['imports', 1]]
			);
		});

		test('sums multiple entity edges landing on the same direction before comparing directions', () => {
			const extraNode: DiagramNode = { id: 'group:handlers', kind: 'group', label: 'handlers' };
			const twoControllers = {
				...identification,
				assignments: [...identification.assignments, { groupId: 'group:handlers', role: 'Controller' }]
			};
			const edges: DiagramEdge[] = [
				{ id: 'f1', source: 'group:controllers', target: 'group:services', kinds: [{ kind: 'calls', count: 1 }] },
				{ id: 'f2', source: 'group:handlers', target: 'group:services', kinds: [{ kind: 'calls', count: 1 }] },
				{ id: 'f3', source: 'group:handlers', target: 'group:services', kinds: [{ kind: 'calls', count: 1 }] },
				{ id: 'b1', source: 'group:services', target: 'group:controllers', kinds: [{ kind: 'calls', count: 2 }] }
			];

			const result = buildIdentifiedArchitectureModel([...entityNodes, extraNode], edges, twoControllers);
			const controllerRoleId = result.model.nodes.find((node) => node.id === 'group:controllers')?.parentId;

			assert.strictEqual(result.model.edges.length, 1);
			assert.strictEqual(result.model.edges[0].source, controllerRoleId);
			assert.deepStrictEqual(result.model.edges[0].kinds, [{ kind: 'calls', count: 5 }]);
		});

		test('leaves a one-directional pair of role groups as its own separate edge', () => {
			const forward: DiagramEdge = { id: 'f', source: 'group:controllers', target: 'group:services', kinds: [{ kind: 'calls', count: 3 }] };

			const { edges, controllerRoleId, serviceRoleId } = build([forward]);

			assert.strictEqual(edges.length, 1);
			assert.strictEqual(edges[0].source, controllerRoleId);
			assert.strictEqual(edges[0].target, serviceRoleId);
			assert.deepStrictEqual(edges[0].kinds, [{ kind: 'calls', count: 3 }]);
		});
	});

	test('leaves an unassigned module (and any edge touching it) out of the model', () => {
		const identification = {
			patternName: 'x',
			patternDescription: 'y',
			roles: [{ role: 'Controller', description: 'a' }],
			assignments: [{ groupId: 'group:controllers', role: 'Controller' }]
		};

		const result = buildIdentifiedArchitectureModel(entityNodes, [relEdge], identification);

		assert.deepStrictEqual(result.model.nodes.map((node) => node.id).includes('group:services'), false);
		assert.strictEqual(result.model.edges.length, 0);
	});

	test('drops an assignment naming a role missing from the roles list', () => {
		const identification = {
			patternName: 'x',
			patternDescription: 'y',
			roles: [{ role: 'Controller', description: 'a' }],
			assignments: [{ groupId: 'group:controllers', role: 'Ghost Role' }]
		};

		const result = buildIdentifiedArchitectureModel(entityNodes, [], identification);

		assert.strictEqual(result.model.nodes.length, 0);
	});
});

suite('identifiedArchitectureEntities / toArchitectureIdentificationEntities', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('builds one entity per real folder module, summarizing its dependency relations', () => {
		const controllerFile = fileNode(path.join('controllers', 'a.ts'));
		const serviceFile = fileNode(path.join('services', 'b.ts'));
		const controllerFn = symbolNode('func:controller', controllerFile.filePath as string);
		const serviceFn = symbolNode('func:service', serviceFile.filePath as string);
		store.upsertNodes([controllerFile, serviceFile, controllerFn, serviceFn]);
		store.upsertEdge(edge('contains:1', 'contains', controllerFile.id, controllerFn.id));
		store.upsertEdge(edge('contains:2', 'contains', serviceFile.id, serviceFn.id));
		store.upsertEdge(edge('calls:1', 'calls', controllerFn.id, serviceFn.id));

		const graph = store.getGraph();
		const { groups, entityNodes, edges } = identifiedArchitectureEntities(store, graph, ROOT);

		assert.deepStrictEqual(
			groups.map((group) => group.groupId).sort(),
			['group:controllers', 'group:services']
		);
		assert.strictEqual(entityNodes.length, 2);

		const entities = toArchitectureIdentificationEntities(graph, groups, edges);
		const controllerEntity = entities.find((entity) => entity.groupId === 'group:controllers');
		const serviceEntity = entities.find((entity) => entity.groupId === 'group:services');

		assert.strictEqual(controllerEntity?.symbolCount, 1);
		assert.deepStrictEqual(controllerEntity?.dependsOn, [{ label: 'services', kinds: ['calls'] }]);
		assert.deepStrictEqual(serviceEntity?.dependedOnBy, [{ label: 'controllers', kinds: ['calls'] }]);
	});
});

suite('hashArchitectureIdentificationEntities', () => {
	test('is stable regardless of input order', () => {
		const a = [{ groupId: 'g1', label: 'g1', fileNames: ['a.ts', 'b.ts'], symbolCount: 0, dependsOn: [], dependedOnBy: [] }];
		const b = [{ groupId: 'g1', label: 'g1', fileNames: ['b.ts', 'a.ts'], symbolCount: 0, dependsOn: [], dependedOnBy: [] }];

		assert.strictEqual(hashArchitectureIdentificationEntities(a), hashArchitectureIdentificationEntities(b));
	});

	test('differs when the module set differs', () => {
		const a = [{ groupId: 'g1', label: 'g1', fileNames: ['a.ts'], symbolCount: 0, dependsOn: [], dependedOnBy: [] }];
		const b = [{ groupId: 'g1', label: 'g1', fileNames: ['a.ts', 'b.ts'], symbolCount: 0, dependsOn: [], dependedOnBy: [] }];

		assert.notStrictEqual(hashArchitectureIdentificationEntities(a), hashArchitectureIdentificationEntities(b));
	});
});

suite('resolveCachedIdentifiedArchitecture / applyArchitectureIdentification', () => {
	let store: ProjectGraphStore;

	const entityNodes: DiagramNode[] = [{ id: 'group:controllers', kind: 'group', label: 'controllers' }];
	const entities = [{ groupId: 'group:controllers', label: 'controllers', fileNames: ['a.ts'], symbolCount: 0, dependsOn: [], dependedOnBy: [] }];
	const identification = {
		patternName: 'Layered Architecture',
		patternDescription: 'y',
		roles: [{ role: 'Controller', description: 'a' }],
		assignments: [{ groupId: 'group:controllers', role: 'Controller' }]
	};

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('reports stale with no model when nothing is cached', () => {
		const resolved = resolveCachedIdentifiedArchitecture(store, entityNodes, [], entities);
		assert.strictEqual(resolved.model, undefined);
		assert.strictEqual(resolved.stale, true);
	});

	test('applying an identification caches it and resolving it back is fresh', () => {
		const applied = applyArchitectureIdentification(store, entityNodes, [], entities, identification);
		assert.strictEqual(applied.patternName, 'Layered Architecture');

		const resolved = resolveCachedIdentifiedArchitecture(store, entityNodes, [], entities);
		assert.strictEqual(resolved.stale, false);
		assert.strictEqual(resolved.model?.patternName, 'Layered Architecture');
	});

	test('resolving with a different module set reports the cached result as stale', () => {
		applyArchitectureIdentification(store, entityNodes, [], entities, identification);

		const changedEntities = [{ ...entities[0], fileNames: ['a.ts', 'b.ts'] }];
		const resolved = resolveCachedIdentifiedArchitecture(store, entityNodes, [], changedEntities);

		assert.strictEqual(resolved.stale, true);
		assert.ok(resolved.model);
	});
});
