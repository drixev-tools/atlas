import * as assert from 'assert';
import * as vscode from 'vscode';
import { ANALYZE_WORKSPACE_COMMAND, CALCULATE_IMPACT_COMMAND, DESIGN_PROJECT_COMMAND } from '../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension is present and activates', async () => {
		const extension = vscode.extensions.getExtension('agent-graph.agent-graph');
		assert.ok(extension);
		await extension?.activate();
		assert.strictEqual(extension?.isActive, true);
	});

	test('registers the "Project Graph: Analyze Workspace" command', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('agentGraph.analyzeWorkspace'));
	});

	test('registers the "Project Graph: Open Architecture" command', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('agentGraph.openArchitecture'));
	});

	test('registers the "Project Graph: Calculate Impact" command', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('agentGraph.calculateImpact'));
	});

	test('registers the "Project Graph: Design Project" command', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('agentGraph.designProject'));
	});

	test('the analyze-workspace command reports an error instead of throwing when no folder is open', async () => {
		assert.strictEqual(vscode.workspace.workspaceFolders, undefined, 'this suite expects no workspace folder open');
		await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(ANALYZE_WORKSPACE_COMMAND)));
	});

	test('the calculate-impact command reports an error instead of throwing when no folder is open', async () => {
		assert.strictEqual(vscode.workspace.workspaceFolders, undefined, 'this suite expects no workspace folder open');
		await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(CALCULATE_IMPACT_COMMAND)));
	});

	test('the design-project command reports an error instead of throwing when no folder is open', async () => {
		assert.strictEqual(vscode.workspace.workspaceFolders, undefined, 'this suite expects no workspace folder open');
		await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(DESIGN_PROJECT_COMMAND)));
	});

	/**
	 * The Cytoscape.js graph viewer this command used to open (Epic 6) was
	 * retired in Fase 1.2, Epic D, pending the React Flow rebuild (Epic F).
	 * It must not throw or silently no-op — it needs to leave the user with a
	 * clear "not available yet" message instead.
	 */
	test('the open-architecture command reports it is temporarily unavailable instead of opening a graph view', async () => {
		await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand('agentGraph.openArchitecture')));

		const tab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((t) => t.label === 'Project Graph');
		assert.strictEqual(tab, undefined, 'expected no "Project Graph" webview tab to open');
	});
});
