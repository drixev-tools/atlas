// Extraction pipelines (TS/JS, Python) that produce graph data from source code.
// The common graph model lives in ./model so every pipeline normalizes to the
// same nodes/edges shape consumed by persistence (Epic 4) and the renderer
// (Epic 6).
export * from './model';
export * as tsPipeline from './ts';
