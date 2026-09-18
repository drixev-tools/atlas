import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { applySchema } from './schema';

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

/**
 * sql.js ships as a WASM build so the Atlas Core has no native
 * addon to rebuild per platform/Electron ABI — it just needs its .wasm
 * binary read off disk once per process, which `getSqlJs` caches.
 */
function getSqlJs(): Promise<SqlJsStatic> {
	if (!sqlJsPromise) {
		const buffer = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
		const wasmBinary = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
		sqlJsPromise = initSqlJs({ wasmBinary });
	}
	return sqlJsPromise;
}

export interface OpenDatabaseOptions {
	/** Path to load/persist the database file. When omitted, the database only exists in memory for the lifetime of the process. */
	filePath?: string;
}

/**
 * Opens the Atlas SQLite database: loads it from `filePath` if a
 * database file already exists there (e.g. from a previous VS Code
 * session), or starts a fresh one otherwise, then ensures the schema is
 * applied either way. sql.js keeps the database entirely in memory, so
 * callers that pass `filePath` must call `saveDatabase` to persist changes.
 */
export async function openDatabase(options: OpenDatabaseOptions = {}): Promise<Database> {
	const SQL = await getSqlJs();
	const db =
		options.filePath && fs.existsSync(options.filePath)
			? new SQL.Database(fs.readFileSync(options.filePath))
			: new SQL.Database();
	applySchema(db);
	return db;
}

export function saveDatabase(db: Database, filePath: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, Buffer.from(db.export()));
}
