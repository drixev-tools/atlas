// Pure Markdown+Mermaid serializer shared by every diagram export: a
// `flowchart LR` for any `DiagramModel` (the layered-architecture and
// entry-point-flow views' data) and a `sequenceDiagram` for the sequence
// view's lifelines/messages. Kept free of `vscode`/React so it can be unit
// tested directly, like ./diagramModel itself. A `DiagramModel`/graph id
// (e.g. `file:/project/src/a.ts`) isn't a valid Mermaid node id, so every id
// gets a short synthetic replacement here; only the visible label carries the
// real name.
import { EdgeKind } from '../pipelines/model';
import { DiagramEdge, DiagramModel, DiagramNode } from './diagramModel';

export interface MermaidSequenceLifeline {
	id: string;
	label: string;
}

export interface MermaidSequenceStep {
	order: number;
	fromLifelineId: string;
	toLifelineId: string;
	label: string;
}

const EDGE_KIND_PRIORITY: readonly EdgeKind[] = ['calls', 'imports', 'extends', 'implements', 'instantiates', 'exports', 'contains'];

class MermaidIdAllocator {
	private readonly idByOriginal = new Map<string, string>();
	private counter = 0;

	resolve(originalId: string): string {
		const existing = this.idByOriginal.get(originalId);
		if (existing) {
			return existing;
		}
		const id = `n${this.counter++}`;
		this.idByOriginal.set(originalId, id);
		return id;
	}
}

function escapeMermaidText(text: string): string {
	return text.replace(/"/g, '#quot;').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function summarizeEdgeKinds(kinds: DiagramEdge['kinds']): string {
	return [...kinds]
		.sort((a, b) => EDGE_KIND_PRIORITY.indexOf(a.kind) - EDGE_KIND_PRIORITY.indexOf(b.kind))
		.map((entry) => (entry.count > 1 ? `${entry.kind} x${entry.count}` : entry.kind))
		.join(', ');
}

/** `model` as a Mermaid `flowchart LR` body (no surrounding code fence — see `toMermaidMarkdown`): a nested `subgraph` per `DiagramNode` with children (mirroring `DiagramNode.parentId`), a plain node line per leaf, then one edge line per `DiagramEdge` labeled with its aggregated kinds. */
export function diagramModelToMermaidFlowchart(model: DiagramModel): string {
	const ids = new MermaidIdAllocator();
	const childrenByParent = new Map<string, DiagramNode[]>();
	const topLevel: DiagramNode[] = [];
	for (const node of model.nodes) {
		if (node.parentId) {
			const siblings = childrenByParent.get(node.parentId) ?? [];
			siblings.push(node);
			childrenByParent.set(node.parentId, siblings);
		} else {
			topLevel.push(node);
		}
	}

	const lines: string[] = ['flowchart LR'];

	function renderNode(node: DiagramNode, depth: number): void {
		const indent = '\t'.repeat(depth);
		const id = ids.resolve(node.id);
		const children = childrenByParent.get(node.id);
		if (children && children.length > 0) {
			lines.push(`${indent}subgraph ${id}["${escapeMermaidText(node.label)}"]`);
			for (const child of children) {
				renderNode(child, depth + 1);
			}
			lines.push(`${indent}end`);
		} else {
			lines.push(`${indent}${id}["${escapeMermaidText(node.label)}"]`);
		}
	}

	for (const node of topLevel) {
		renderNode(node, 1);
	}

	for (const edge of model.edges) {
		const sourceId = ids.resolve(edge.source);
		const targetId = ids.resolve(edge.target);
		lines.push(`\t${sourceId} -->|${escapeMermaidText(summarizeEdgeKinds(edge.kinds))}| ${targetId}`);
	}

	return lines.join('\n');
}

/** `lifelines`/`steps` as a Mermaid `sequenceDiagram` body (no surrounding code fence): one `participant` declaration per lifeline, then one message per step in `order`. */
export function sequenceToMermaidDiagram(lifelines: readonly MermaidSequenceLifeline[], steps: readonly MermaidSequenceStep[]): string {
	const ids = new MermaidIdAllocator();
	const lines: string[] = ['sequenceDiagram'];

	for (const lifeline of lifelines) {
		lines.push(`\tparticipant ${ids.resolve(lifeline.id)} as ${escapeMermaidText(lifeline.label)}`);
	}

	for (const step of [...steps].sort((a, b) => a.order - b.order)) {
		const fromId = ids.resolve(step.fromLifelineId);
		const toId = ids.resolve(step.toLifelineId);
		lines.push(`\t${fromId}->>${toId}: ${escapeMermaidText(step.label)}`);
	}

	return lines.join('\n');
}

/** Wraps a Mermaid diagram body (`diagramModelToMermaidFlowchart`/`sequenceToMermaidDiagram`) into a standalone Markdown document: a `title` heading followed by a fenced ` ```mermaid ` code block. */
export function toMermaidMarkdown(title: string, mermaidBody: string): string {
	return `# ${title}\n\n\`\`\`mermaid\n${mermaidBody}\n\`\`\`\n`;
}
