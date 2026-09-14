const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			console.log('[watch] build finished');
		});
	}
};

async function main() {
	const extensionCtx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		// sql.js (Epic 4, Project Graph Core) loads its .wasm binary from
		// node_modules at runtime; bundling it would strip out that asset.
		// Packaging it into the shipped extension is an Epic 12 concern.
		external: ['vscode', 'sql.js'],
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin]
	});
	// Runs inside the graph webview's own browser context (Epic 6), so it's
	// bundled fully standalone, Cytoscape.js included, rather than treated
	// like a Node dependency of the extension host.
	const webviewCtx = await esbuild.context({
		entryPoints: ['src/ui/webview/main.ts'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/ui/webview/main.js',
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin]
	});

	if (watch) {
		await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
	} else {
		await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
		await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
