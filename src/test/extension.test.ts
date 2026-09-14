import * as assert from 'assert';
import * as vscode from 'vscode';
import { ANALYZE_WORKSPACE_COMMAND } from '../extension';

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

	test('the analyze-workspace command reports an error instead of throwing when no folder is open', async () => {
		assert.strictEqual(vscode.workspace.workspaceFolders, undefined, 'this suite expects no workspace folder open');
		await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(ANALYZE_WORKSPACE_COMMAND)));
	});
});
