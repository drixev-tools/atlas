import type { Database } from 'sql.js';

/**
 * Where a node/edge stands relative to a design ("proposed") graph once Epic
 * 10 (Proposed vs Observed) compares it against what the extraction
 * pipelines actually found in the code ("observed"). Until that comparison
 * exists, everything the pipelines produce is tagged `observed_only`.
 */
export type GraphStatus = 'matched' | 'proposed_only' | 'observed_only';

export const GRAPH_STATUSES: readonly GraphStatus[] = ['matched', 'proposed_only', 'observed_only'];

export const DEFAULT_GRAPH_STATUS: GraphStatus = 'observed_only';

/**
 * Schema for the Project Graph Core. A single `nodes`/`edges` pair holds the
 * whole workspace graph, keyed by the same ids the pipelines already assign
 * (see each pipeline's normalize.ts), so upserts from repeated extraction
 * runs (full or, from Epic 5 on, incremental) collapse onto the same rows.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	name TEXT NOT NULL,
	file_path TEXT,
	language TEXT,
	exported INTEGER,
	start_line INTEGER,
	start_column INTEGER,
	end_line INTEGER,
	end_column INTEGER,
	metadata TEXT,
	status TEXT NOT NULL DEFAULT 'observed_only' CHECK (status IN ('matched', 'proposed_only', 'observed_only'))
);

CREATE TABLE IF NOT EXISTS edges (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
	target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
	metadata TEXT,
	status TEXT NOT NULL DEFAULT 'observed_only' CHECK (status IN ('matched', 'proposed_only', 'observed_only'))
);

CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_status ON edges(status);
`;

export function applySchema(db: Database): void {
	db.exec('PRAGMA foreign_keys = ON;');
	db.exec(SCHEMA_SQL);
}
