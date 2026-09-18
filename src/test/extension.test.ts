import * as assert from 'assert';
import * as vscode from 'vscode';
import { ANALYZE_WORKSPACE_COMMAND, SHOW_SEQUENCE_DIAGRAM_COMMAND } from '../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension is present and activates', async () => {
		const extension = vscode.extensions.getExtension('atlas.atlas');
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

	test('registers the "Show Sequence Diagram" command', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('agentGraph.showSequenceDiagram'));
	});

	test('the show-sequence-diagram command reports an error instead of throwing when no file is open', async () => {
		await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(SHOW_SEQUENCE_DIAGRAM_COMMAND)));
	});

	test('the analyze-workspace command reports an error instead of throwing when no folder is open', async () => {
		assert.strictEqual(vscode.workspace.workspaceFolders, undefined, 'this suite expects no workspace folder open');
		await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(ANALYZE_WORKSPACE_COMMAND)));
	});

	// The open-architecture command's actual behavior (opening/reviving the
	// React Flow graph panel) is covered in ui/graphPanel.test.ts, next to
	// the `GraphPanel` it opens.
});
