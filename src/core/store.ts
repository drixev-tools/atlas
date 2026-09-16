import type { BindParams, Database, ParamsObject } from 'sql.js';
import { EdgeKind, GraphEdge, GraphNode, NodeKind } from '../pipelines/model';
import { DEFAULT_GRAPH_STATUS, GraphStatus } from './schema';
import { OpenDatabaseOptions, openDatabase, saveDatabase } from './database';

export interface StoredNode extends GraphNode {
	status: GraphStatus;
}

export interface StoredEdge extends GraphEdge {
	status: GraphStatus;
}

export interface StoredGraph {
	nodes: StoredNode[];
	edges: StoredEdge[];
}

export interface NodeFilter {
	kind?: NodeKind;
	status?: GraphStatus;
	filePath?: string;
}

export interface EdgeFilter {
	kind?: EdgeKind;
	status?: GraphStatus;
	source?: string;
	target?: string;
}

export type EdgeDirection = 'in' | 'out' | 'both';

function serializeMetadata(metadata: Record<string, unknown> | undefined): string | null {
	return metadata ? JSON.stringify(metadata) : null;
}

function deserializeMetadata(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'string' ? (JSON.parse(value) as Record<string, unknown>) : undefined;
}

function rowToNode(row: ParamsObject): StoredNode {
	const node: StoredNode = {
		id: row.id as string,
		kind: row.kind as NodeKind,
		name: row.name as string,
		status: row.status as GraphStatus
	};
	if (row.file_path !== null) {
		node.filePath = row.file_path as string;
	}
	if (row.language !== null) {
		node.language = row.language as string;
	}
	if (row.exported !== null) {
		node.exported = Boolean(row.exported);
	}
	if (row.start_line !== null) {
		node.range = {
			startLine: row.start_line as number,
			startColumn: row.start_column as number,
			endLine: row.end_line as number,
			endColumn: row.end_column as number
		};
	}
	const metadata = deserializeMetadata(row.metadata);
	if (metadata) {
		node.metadata = metadata;
	}
	return node;
}

function rowToEdge(row: ParamsObject): StoredEdge {
	const edge: StoredEdge = {
		id: row.id as string,
		kind: row.kind as EdgeKind,
		source: row.source_id as string,
		target: row.target_id as string,
		status: row.status as GraphStatus
	};
	const metadata = deserializeMetadata(row.metadata);
	if (metadata) {
		edge.metadata = metadata;
	}
	return edge;
}

function buildNodeWhere(filter: NodeFilter): { clause: string; params: BindParams } {
	const conditions: string[] = [];
	const params: (string | number)[] = [];
	if (filter.kind) {
		conditions.push('kind = ?');
		params.push(filter.kind);
	}
	if (filter.status) {
		conditions.push('status = ?');
		params.push(filter.status);
	}
	if (filter.filePath) {
		conditions.push('file_path = ?');
		params.push(filter.filePath);
	}
	return { clause: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

function buildEdgeWhere(filter: EdgeFilter): { clause: string; params: BindParams } {
	const conditions: string[] = [];
	const params: (string | number)[] = [];
	if (filter.kind) {
		conditions.push('kind = ?');
		params.push(filter.kind);
	}
	if (filter.status) {
		conditions.push('status = ?');
		params.push(filter.status);
	}
	if (filter.source) {
		conditions.push('source_id = ?');
		params.push(filter.source);
	}
	if (filter.target) {
		conditions.push('target_id = ?');
		params.push(filter.target);
	}
	return { clause: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

/**
 * Data-access layer over the Project Graph Core's SQLite database: CRUD for
 * nodes and edges plus the query helpers the renderer and the
 * Analyze/Explore/Impact commands need. Callers that only need an in-memory
 * graph for a single pipeline run can construct this
 * directly around any open `Database`; most callers should use `open`/
 * `save`/`close` to manage a database file across VS Code sessions.
 */
export class ProjectGraphStore {
	private constructor(
		private readonly db: Database,
		private filePath: string | undefined
	) {}

	static async open(options: OpenDatabaseOptions = {}): Promise<ProjectGraphStore> {
		const db = await openDatabase(options);
		return new ProjectGraphStore(db, options.filePath);
	}

	static fromDatabase(db: Database): ProjectGraphStore {
		return new ProjectGraphStore(db, undefined);
	}

	/** Persists the current in-memory database to disk, since sql.js never writes to `filePath` on its own. */
	save(filePath: string | undefined = this.filePath): void {
		if (!filePath) {
			throw new Error('ProjectGraphStore.save() requires a filePath, either passed here or to open().');
		}
		this.filePath = filePath;
		saveDatabase(this.db, filePath);
	}

	close(): void {
		this.db.close();
	}

	upsertNode(node: GraphNode, status: GraphStatus = DEFAULT_GRAPH_STATUS): void {
		this.db.run(
			`INSERT INTO nodes (id, kind, name, file_path, language, exported, start_line, start_column, end_line, end_column, metadata, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
				kind = excluded.kind,
				name = excluded.name,
				file_path = excluded.file_path,
				language = excluded.language,
				exported = excluded.exported,
				start_line = excluded.start_line,
				start_column = excluded.start_column,
				end_line = excluded.end_line,
				end_column = excluded.end_column,
				metadata = excluded.metadata,
				status = excluded.status`,
			[
				node.id,
				node.kind,
				node.name,
				node.filePath ?? null,
				node.language ?? null,
				node.exported === undefined ? null : node.exported ? 1 : 0,
				node.range?.startLine ?? null,
				node.range?.startColumn ?? null,
				node.range?.endLine ?? null,
				node.range?.endColumn ?? null,
				serializeMetadata(node.metadata),
				status
			]
		);
	}

	upsertNodes(nodes: GraphNode[], status: GraphStatus = DEFAULT_GRAPH_STATUS): void {
		for (const node of nodes) {
			this.upsertNode(node, status);
		}
	}

	getNode(id: string): StoredNode | undefined {
		const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
		try {
			stmt.bind([id]);
			return stmt.step() ? rowToNode(stmt.getAsObject()) : undefined;
		} finally {
			stmt.free();
		}
	}

	listNodes(filter: NodeFilter = {}): StoredNode[] {
		const { clause, params } = buildNodeWhere(filter);
		return this.queryNodes(`SELECT * FROM nodes${clause}`, params);
	}

	setNodeStatus(id: string, status: GraphStatus): void {
		this.db.run('UPDATE nodes SET status = ? WHERE id = ?', [status, id]);
	}

	deleteNode(id: string): void {
		this.db.run('DELETE FROM nodes WHERE id = ?', [id]);
	}

	upsertEdge(edge: GraphEdge, status: GraphStatus = DEFAULT_GRAPH_STATUS): void {
		this.db.run(
			`INSERT INTO edges (id, kind, source_id, target_id, metadata, status)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
				kind = excluded.kind,
				source_id = excluded.source_id,
				target_id = excluded.target_id,
				metadata = excluded.metadata,
				status = excluded.status`,
			[edge.id, edge.kind, edge.source, edge.target, serializeMetadata(edge.metadata), status]
		);
	}

	upsertEdges(edges: GraphEdge[], status: GraphStatus = DEFAULT_GRAPH_STATUS): void {
		for (const edge of edges) {
			this.upsertEdge(edge, status);
		}
	}

	getEdge(id: string): StoredEdge | undefined {
		const stmt = this.db.prepare('SELECT * FROM edges WHERE id = ?');
		try {
			stmt.bind([id]);
			return stmt.step() ? rowToEdge(stmt.getAsObject()) : undefined;
		} finally {
			stmt.free();
		}
	}

	listEdges(filter: EdgeFilter = {}): StoredEdge[] {
		const { clause, params } = buildEdgeWhere(filter);
		return this.queryEdges(`SELECT * FROM edges${clause}`, params);
	}

	/** Edges touching `nodeId`, either as source (`out`), target (`in`), or either (`both`, the default). */
	getEdgesForNode(nodeId: string, direction: EdgeDirection = 'both'): StoredEdge[] {
		if (direction === 'out') {
			return this.queryEdges('SELECT * FROM edges WHERE source_id = ?', [nodeId]);
		}
		if (direction === 'in') {
			return this.queryEdges('SELECT * FROM edges WHERE target_id = ?', [nodeId]);
		}
		return this.queryEdges('SELECT * FROM edges WHERE source_id = ? OR target_id = ?', [nodeId, nodeId]);
	}

	setEdgeStatus(id: string, status: GraphStatus): void {
		this.db.run('UPDATE edges SET status = ? WHERE id = ?', [status, id]);
	}

	deleteEdge(id: string): void {
		this.db.run('DELETE FROM edges WHERE id = ?', [id]);
	}

	/** The whole stored graph (or just one status slice of it), e.g. for the renderer. */
	getGraph(filter: { status?: GraphStatus } = {}): StoredGraph {
		return {
			nodes: this.listNodes(filter),
			edges: this.listEdges(filter)
		};
	}

	/** Removes every node and edge. Used for a full re-population; see ./incremental for the incremental upsert/delete path that avoids clearing wholesale. */
	clear(): void {
		this.db.run('DELETE FROM edges; DELETE FROM nodes;');
	}

	/**
	 * Removes only the nodes/edges tagged `status`, leaving every other status
	 * slice untouched. Used to re-populate just the Proposed Graph without
	 * disturbing the Observed Graph the extraction pipelines built —
	 * unlike `clear()`, which wipes the whole store for a full rebuild. Edges
	 * are deleted before nodes so the `ON DELETE CASCADE` from a node of this
	 * status never reaches into an edge of a *different* status that happens
	 * to reference it.
	 */
	clearByStatus(status: GraphStatus): void {
		this.db.run('DELETE FROM edges WHERE status = ?', [status]);
		this.db.run('DELETE FROM nodes WHERE status = ?', [status]);
	}

	private queryNodes(sql: string, params: BindParams): StoredNode[] {
		const stmt = this.db.prepare(sql);
		try {
			stmt.bind(params);
			const rows: StoredNode[] = [];
			while (stmt.step()) {
				rows.push(rowToNode(stmt.getAsObject()));
			}
			return rows;
		} finally {
			stmt.free();
		}
	}

	private queryEdges(sql: string, params: BindParams): StoredEdge[] {
		const stmt = this.db.prepare(sql);
		try {
			stmt.bind(params);
			const rows: StoredEdge[] = [];
			while (stmt.step()) {
				rows.push(rowToEdge(stmt.getAsObject()));
			}
			return rows;
		} finally {
			stmt.free();
		}
	}
}
