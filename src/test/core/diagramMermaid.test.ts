import * as assert from 'assert';
import { DiagramModel } from '../../core/diagramModel';
import { diagramModelToMermaidFlowchart, MermaidSequenceLifeline, MermaidSequenceStep, sequenceToMermaidDiagram, toMermaidMarkdown } from '../../core/diagramMermaid';

suite('diagramModelToMermaidFlowchart', () => {
	test('starts with a flowchart LR header', () => {
		const model: DiagramModel = { nodes: [], edges: [] };
		const mermaid = diagramModelToMermaidFlowchart(model);
		assert.ok(mermaid.startsWith('flowchart LR'));
	});

	test('renders a leaf node as a bracketed label with a synthetic id', () => {
		const model: DiagramModel = {
			nodes: [{ id: 'file:/project/a.ts', kind: 'file', label: 'a.ts' }],
			edges: []
		};
		const mermaid = diagramModelToMermaidFlowchart(model);
		assert.ok(mermaid.includes('n0["a.ts"]'), mermaid);
	});

	test('nests a node with children into a subgraph rather than a plain edge', () => {
		const model: DiagramModel = {
			nodes: [
				{ id: 'file:a', kind: 'file', label: 'a.ts' },
				{ id: 'class:C', kind: 'class', label: 'C', parentId: 'file:a' }
			],
			edges: []
		};
		const mermaid = diagramModelToMermaidFlowchart(model);
		const lines = mermaid.split('\n');
		assert.ok(lines.some((line) => line.includes('subgraph n0["a.ts"]')));
		assert.ok(lines.some((line) => line.trim() === 'n1["C"]'));
		assert.ok(lines.some((line) => line.trim() === 'end'));
	});

	test('labels an edge with its aggregated kinds, priority-ordered and count-suffixed above 1', () => {
		const model: DiagramModel = {
			nodes: [
				{ id: 'a', kind: 'file', label: 'a.ts' },
				{ id: 'b', kind: 'file', label: 'b.ts' }
			],
			edges: [
				{
					id: 'e1',
					source: 'a',
					target: 'b',
					kinds: [
						{ kind: 'imports', count: 1 },
						{ kind: 'calls', count: 3 }
					]
				}
			]
		};
		const mermaid = diagramModelToMermaidFlowchart(model);
		assert.ok(mermaid.includes('n0 -->|calls x3, imports| n1'), mermaid);
	});

	test('escapes quotes and pipes in a label', () => {
		const model: DiagramModel = {
			nodes: [{ id: 'a', kind: 'file', label: 'weird "name" | here' }],
			edges: []
		};
		const mermaid = diagramModelToMermaidFlowchart(model);
		assert.ok(mermaid.includes('n0["weird #quot;name#quot; \\| here"]'), mermaid);
	});
});

suite('sequenceToMermaidDiagram', () => {
	test('starts with a sequenceDiagram header and declares every lifeline as a participant', () => {
		const lifelines: MermaidSequenceLifeline[] = [
			{ id: 'file:/repo/math.ts', label: 'math.ts' },
			{ id: 'file:/repo/app.ts', label: 'app.ts' }
		];
		const mermaid = sequenceToMermaidDiagram(lifelines, []);
		const lines = mermaid.split('\n');
		assert.strictEqual(lines[0], 'sequenceDiagram');
		assert.ok(lines.some((line) => line.includes('participant n0 as math.ts')));
		assert.ok(lines.some((line) => line.includes('participant n1 as app.ts')));
	});

	test('orders messages by step order, not input order', () => {
		const lifelines: MermaidSequenceLifeline[] = [
			{ id: 'a', label: 'A' },
			{ id: 'b', label: 'B' }
		];
		const steps: MermaidSequenceStep[] = [
			{ order: 1, fromLifelineId: 'b', toLifelineId: 'a', label: 'calls back' },
			{ order: 0, fromLifelineId: 'a', toLifelineId: 'b', label: 'calls first' }
		];
		const mermaid = sequenceToMermaidDiagram(lifelines, steps);
		const messageLines = mermaid.split('\n').filter((line) => line.includes('->>'));
		assert.deepStrictEqual(messageLines, ['\tn0->>n1: calls first', '\tn1->>n0: calls back']);
	});

	test('reuses the same synthetic id for a lifeline referenced by both a participant declaration and a step', () => {
		const lifelines: MermaidSequenceLifeline[] = [{ id: 'file:a', label: 'a.ts' }];
		const steps: MermaidSequenceStep[] = [{ order: 0, fromLifelineId: 'file:a', toLifelineId: 'file:a', label: 'self call' }];
		const mermaid = sequenceToMermaidDiagram(lifelines, steps);
		assert.ok(mermaid.includes('participant n0 as a.ts'));
		assert.ok(mermaid.includes('n0->>n0: self call'));
	});
});

suite('toMermaidMarkdown', () => {
	test('wraps the mermaid body in a heading and a mermaid code fence', () => {
		const markdown = toMermaidMarkdown('My Diagram', 'flowchart LR\n\tn0["a"]');
		assert.strictEqual(markdown, '# My Diagram\n\n```mermaid\nflowchart LR\n\tn0["a"]\n```\n');
	});
});
