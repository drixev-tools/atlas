// Project Graph Core: persistence and querying of the extracted code graph.
// The SQLite schema and status enum live in ./schema, the sql.js engine/file
// handling in ./database, the CRUD data-access layer in ./store, loading
// pipeline output into the store in ./populate, single-file diff/update
// helpers in ./incremental, and the VS Code file system watcher that drives
// them in ./watcher.
export * from './schema';
export * from './database';
export * from './store';
export * from './populate';
export * from './incremental';
export * from './watcher';
