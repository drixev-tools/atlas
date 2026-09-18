// Relates a code file to the test file(s) that exercise it (see
// ../core/diagramMetrics for one consumer). A file is
// considered related two ways: it's imported by something that looks like a
// test (structural, via `getStructuralConsumersForFile`), or its name follows
// one of the common test-naming conventions paired to the code file's own
// name (e.g. `foo.ts` <-> `foo.test.ts`, `math_utils.py` <-> `test_math_utils.py`),
// which also catches tests that exercise a module without importing it
// directly (e.g. through a CLI entry point or test runner discovery).
import * as path from 'path';
import { getStructuralConsumersForFile } from './impact';
import { AtlasStore } from './store';

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

const TEST_NAME_PATTERNS: RegExp[] = [/\.test\.[jt]sx?$/i, /\.spec\.[jt]sx?$/i, /^test_.*\.py$/i, /.*_test\.py$/i];

const TEST_DIR_NAMES = new Set(['__tests__', 'tests', 'test']);

/**
 * Whether `filePath` looks like a test file by naming convention: a TS/JS
 * `*.test.ts(x)`/`*.spec.ts(x)` suffix, a Python `test_*.py`/`*_test.py`
 * name, or living directly under a conventional test directory
 * (`__tests__/`, `tests/`, `test/`).
 */
export function isLikelyTestFilePath(filePath: string): boolean {
	const base = path.basename(filePath);
	if (TEST_NAME_PATTERNS.some((pattern) => pattern.test(base))) {
		return true;
	}
	return filePath.split(/[\\/]/).some((segment) => TEST_DIR_NAMES.has(segment));
}

function candidateTestBaseNames(baseNameNoExt: string): Set<string> {
	return new Set([`${baseNameNoExt}.test`, `${baseNameNoExt}.spec`, `test_${baseNameNoExt}`, `${baseNameNoExt}_test`]);
}

/**
 * Absolute paths of the test files related to `filePath` (empty for a file
 * that is itself already a test). Combines consumers of `filePath` that are
 * named like a test with any other project file whose name pairs with
 * `filePath`'s own base name by convention.
 */
export function findRelatedTestFiles(store: AtlasStore, filePath: string): string[] {
	if (isLikelyTestFilePath(filePath)) {
		return [];
	}

	const related = new Set<string>();

	for (const node of getStructuralConsumersForFile(store, filePath)) {
		if (node.kind === 'file' && node.filePath && isLikelyTestFilePath(node.filePath)) {
			related.add(node.filePath);
		}
	}

	const selfId = fileNodeId(filePath);
	const baseNameNoExt = path.basename(filePath, path.extname(filePath));
	const candidates = candidateTestBaseNames(baseNameNoExt);

	for (const node of store.listNodes({ kind: 'file' })) {
		if (!node.filePath || fileNodeId(node.filePath) === selfId) {
			continue;
		}
		const otherBaseNoExt = path.basename(node.filePath, path.extname(node.filePath));
		if (candidates.has(otherBaseNoExt)) {
			related.add(node.filePath);
		}
	}

	return [...related];
}
