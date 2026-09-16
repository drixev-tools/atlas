// Best-effort entry-point detection over the Project Graph: the handful of
// places execution is known to start from outside the graph itself rather
// than from another function's call, for the flow view's starting-point
// picker and the architecture view's entry-point badges planned for Fase
// 1.3. Every kind here is read directly off data the extraction pipelines
// already produce — nothing is inferred from source constructs the
// pipelines don't parse (e.g. decorators), the same "never guessed" rule
// Epic L applies to unresolvable Python relations.
import { ProjectGraphStore, StoredNode } from './store';

export type EntryPointKind = 'activate' | 'command' | 'main' | 'httpRoute';

export interface EntryPoint {
	nodeId: string;
	kind: EntryPointKind;
	name: string;
	filePath?: string;
}

const HTTP_METHOD_NAMES = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

function isFunctionLike(node: StoredNode): boolean {
	return node.kind === 'function' || node.kind === 'method';
}

/**
 * Entry points found in `store`:
 * - `activate`: an exported top-level function named `activate` — the VS
 *   Code extension activation hook.
 * - `command`: whatever an `activate` entry point directly `calls`. This is
 *   how a `vscode.commands.registerCommand(id, handler)` registration
 *   reaches its handler in practice (see `extension.ts`), since the
 *   `registerCommand` call itself never resolves to a project symbol (its
 *   declaration lives in `vscode`'s own types, outside every known file —
 *   see `pipelines/*\/normalize.ts`) for this function to find any other way.
 * - `main`: a top-level function named `main` — a script's conventional
 *   entry point, e.g. Python's `if __name__ == "__main__": main()`.
 * - `httpRoute`: a method named after an HTTP verb (`get`, `post`, ...), a
 *   naming convention several web frameworks' route handlers share.
 */
export function detectEntryPoints(store: ProjectGraphStore): EntryPoint[] {
	const entryPoints: EntryPoint[] = [];
	const seenKeys = new Set<string>();

	const add = (node: StoredNode, kind: EntryPointKind): void => {
		const key = `${kind}:${node.id}`;
		if (seenKeys.has(key)) {
			return;
		}
		seenKeys.add(key);
		entryPoints.push({ nodeId: node.id, kind, name: node.name, filePath: node.filePath });
	};

	const functionLikeNodes = store.listNodes().filter(isFunctionLike);

	const activateNodes = functionLikeNodes.filter((node) => node.kind === 'function' && node.name === 'activate' && node.exported);
	activateNodes.forEach((node) => add(node, 'activate'));

	for (const activateNode of activateNodes) {
		for (const edge of store.listEdges({ kind: 'calls', source: activateNode.id })) {
			const target = store.getNode(edge.target);
			if (target && isFunctionLike(target)) {
				add(target, 'command');
			}
		}
	}

	functionLikeNodes.filter((node) => node.kind === 'function' && node.name === 'main').forEach((node) => add(node, 'main'));

	functionLikeNodes
		.filter((node) => node.kind === 'method' && HTTP_METHOD_NAMES.has(node.name.toLowerCase()))
		.forEach((node) => add(node, 'httpRoute'));

	return entryPoints;
}
