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
	// The Cytoscape.js graph webview this used to also bundle (Epic 6) was
	// retired in Fase 1.2, Epic D; a webview build step returns once the
	// React Flow rebuild (Epic F) adds one back.
	if (watch) {
		await extensionCtx.watch();
	} else {
		await extensionCtx.rebuild();
		await extensionCtx.dispose();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
