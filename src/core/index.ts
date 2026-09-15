// Project Graph Core: persistence and querying of the extracted code graph.
// The SQLite schema and status enum live in ./schema, the sql.js engine/file
// handling in ./database, the CRUD data-access layer in ./store, loading
// pipeline output into the store in ./populate, single-file diff/update
// helpers in ./incremental, and the VS Code file system watcher that drives
// them in ./watcher. Structural dependency/consumer analysis for the Impact
// command (Epic 8) lives in ./impact, the test<->code relation it also needs
// in ./testLinks, and the vscode.git integration backing its default target
// set in ./gitStatus (types for the extension API it talks to in
// ./gitExtensionApi). The Proposed-vs-Observed matching algorithm and status
// annotation (Epic 10) live in ./comparison.
export * from './schema';
export * from './database';
export * from './store';
export * from './populate';
export * from './incremental';
export * from './watcher';
export * from './impact';
export * from './testLinks';
export * from './gitExtensionApi';
export * from './gitStatus';
export * from './comparison';
