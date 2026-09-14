import * as fs from 'fs';
import * as path from 'path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const DEFAULT_IGNORED_DIRS = new Set([
	'node_modules',
	'.git',
	'dist',
	'out',
	'.vscode-test',
	'coverage'
]);

export interface FindSourceFilesOptions {
	ignoredDirs?: Set<string>;
}

/**
 * Recursively finds TS/JS source files under `rootDir`, skipping build output,
 * dependency, and VCS directories. Declaration files (`.d.ts`) are excluded
 * since they carry no executable symbols or imports to extract.
 */
export function findSourceFiles(rootDir: string, options: FindSourceFilesOptions = {}): string[] {
	const ignoredDirs = options.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
	const results: string[] = [];

	const walk = (dir: string): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				if (ignoredDirs.has(entry.name)) {
					continue;
				}
				walk(fullPath);
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			if (entry.name.endsWith('.d.ts')) {
				continue;
			}

			if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
				results.push(fullPath);
			}
		}
	};

	walk(rootDir);
	return results;
}

export function isJavaScriptFile(filePath: string): boolean {
	const ext = path.extname(filePath);
	return ext === '.js' || ext === '.jsx';
}
