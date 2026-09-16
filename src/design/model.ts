// Shared types for "Design Project": the structured-plus-free-text intent a
// user fills in (../ui/designProject's `collectProjectIntent` collects it),
// and the architecture Claude proposes in response (./claudeClient talks to
// the API, ./proposedGraph converts the result into the pipeline-agnostic
// graph model).
import { EdgeKind, NodeKind } from '../pipelines/model';

export type ProjectStack = 'typescript' | 'python' | 'mixed';

/** The intent form's structured fields plus its free-text description. */
export interface ProjectIntent {
	name: string;
	stack: ProjectStack;
	/** Components/modules the user already has in mind, in their own words. May be empty. */
	keyComponents: string[];
	/** Free-form description of what the project/feature should do and how it should be put together. */
	description: string;
}

/**
 * One node of Claude's proposed architecture. `ref` is Claude's own local
 * identifier for the node within a single response — used only to resolve
 * `ProposedEdge.sourceRef`/`targetRef`, never persisted — since a proposed
 * node has no source location yet to derive a stable id from the way the
 * extraction pipelines do (see ./proposedGraph).
 */
export interface ProposedNode {
	ref: string;
	kind: NodeKind;
	name: string;
	/** Workspace-relative path. Required for kind `file`; optional elsewhere (a node scoped to a file that doesn't need its own file node yet). */
	filePath?: string;
	language?: string;
	/** One-sentence responsibility, carried into the stored node's `metadata.description`. */
	description?: string;
}

export interface ProposedEdge {
	kind: EdgeKind;
	sourceRef: string;
	targetRef: string;
	description?: string;
}

/** The full shape returned by Claude's `propose_architecture` tool call. */
export interface ProposedArchitecture {
	nodes: ProposedNode[];
	edges: ProposedEdge[];
}
