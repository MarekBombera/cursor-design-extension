import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
// Named import so lint allows `lm.registerMcpServerDefinitionProvider` and nothing else on `lm`.
import { lm } from 'vscode';

import { logDiskError } from '../host/hostFs';
import {
	VIBEBOARD_MCP_LABEL,
	VIBEBOARD_MCP_SERVER_NAME,
	VIBEBOARD_WORKSPACE_ROOT_ENV,
	VIBEBOARD_WORKSPACE_ROOTS_ENV,
} from './mcpIdentity';

type RegisterVibeboardMcpArgs = {
	context: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
};

type McpServerLaunch = { command: string; args: string[]; env: Record<string, string> };

let mcpDisposeHooked = false;
// VS Code: the provider registers once per host; a later sync swaps the launch and fires the event.
let vsCodeProvider: { launch: McpServerLaunch; changed: vscode.EventEmitter<void> } | undefined;

// VS Code restarts a running server when the definition's version changes; a changed env alone
// (another workspace folder) may not.
const definitionVersion = (launch: McpServerLaunch): string =>
	`${process.env.VIBEBOARD_VERSION ?? '0.0.0'}+${createHash('sha256')
		.update(JSON.stringify(launch.env))
		.digest('hex')
		.slice(0, 12)}`;

const vibeboardServerLaunch = (extensionUri: vscode.Uri): McpServerLaunch => {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	return {
		command: process.execPath,
		args: [vscode.Uri.joinPath(extensionUri, 'dist', 'mcp.js').fsPath],
		env: {
			ELECTRON_RUN_AS_NODE: '1',
			[VIBEBOARD_WORKSPACE_ROOT_ENV]: workspaceFolders[0]?.uri.fsPath ?? '',
			[VIBEBOARD_WORKSPACE_ROOTS_ENV]: JSON.stringify(
				workspaceFolders.map((folder) => folder.uri.fsPath),
			),
		},
	};
};

const reportRegisterFailure = (error: unknown, outputChannel: vscode.OutputChannel): false => {
	logDiskError({ scope: 'registerVibeboardMcp', error, outputChannel });
	void vscode.window.showErrorMessage(
		'Could not register the Vibeboard MCP server. Check the Output panel: Vibeboard.',
	);
	return false;
};

// Cursor runs one server per user for every window under this constant name, so neither a sync
// nor a closing window unregisters it: that would restart or drop the server other windows use.
// ponytail: assumes registerServer replaces a same-named registration (Cursor's API docs do not
// say). If a re-register turns out to be ignored, a new extension path or env never reaches the
// running server until Cursor restarts; upgrade path: unregister only when the launch changed.
const registerCursorServer = ({
	launch,
	outputChannel,
}: {
	launch: McpServerLaunch;
	outputChannel: vscode.OutputChannel;
}): boolean => {
	try {
		vscode.cursor.mcp.registerServer({ name: VIBEBOARD_MCP_SERVER_NAME, server: launch });
	} catch (error: unknown) {
		return reportRegisterFailure(error, outputChannel);
	}
	return true;
};

const provideVsCodeServer = ({
	context,
	launch,
	outputChannel,
}: {
	context: vscode.ExtensionContext;
	launch: McpServerLaunch;
	outputChannel: vscode.OutputChannel;
}): boolean => {
	if (vsCodeProvider !== undefined) {
		vsCodeProvider.launch = launch;
		vsCodeProvider.changed.fire();
		return true;
	}
	const provider = { launch, changed: new vscode.EventEmitter<void>() };
	try {
		context.subscriptions.push(
			provider.changed,
			lm.registerMcpServerDefinitionProvider(VIBEBOARD_MCP_SERVER_NAME, {
				onDidChangeMcpServerDefinitions: provider.changed.event,
				provideMcpServerDefinitions: () => [
					new vscode.McpStdioServerDefinition(
						VIBEBOARD_MCP_LABEL,
						provider.launch.command,
						provider.launch.args,
						provider.launch.env,
						definitionVersion(provider.launch),
					),
				],
			}),
		);
	} catch (error: unknown) {
		provider.changed.dispose();
		return reportRegisterFailure(error, outputChannel);
	}
	vsCodeProvider = provider;
	return true;
};

// Cursor's own MCP API when present, else VS Code's provider API; never both in one host.
export const registerVibeboardMcp = ({
	context,
	outputChannel,
}: RegisterVibeboardMcpArgs): boolean => {
	if (!mcpDisposeHooked) {
		// Deactivate disposes the provider; a later activate in the same host registers afresh.
		context.subscriptions.push({
			dispose: () => {
				vsCodeProvider = undefined;
				mcpDisposeHooked = false;
			},
		});
		mcpDisposeHooked = true;
	}

	// Cursor runs one server per user for every window, and the last registration's env wins: a
	// folder-less window must not replace another window's folders with none. Cursor's shared server
	// still serves this window; VS Code's provider is per window, so there it is unavailable.
	if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
		outputChannel.appendLine('No folder is open. The Vibeboard MCP registration was left as is.');
		return vscode.cursor?.mcp !== undefined;
	}

	if (!vscode.workspace.isTrusted) {
		outputChannel.appendLine('Workspace is untrusted. MCP server was not registered.');
		return false;
	}

	const launch = vibeboardServerLaunch(context.extensionUri);
	if (vscode.cursor?.mcp) {
		return registerCursorServer({ launch, outputChannel });
	}
	// Feature-detected: engines.vscode stays where Cursor can install the extension.
	if (typeof lm?.registerMcpServerDefinitionProvider === 'function') {
		return provideVsCodeServer({ context, launch, outputChannel });
	}
	outputChannel.appendLine(
		'This editor has no MCP API; add the Vibeboard MCP server to your agent manually (see README).',
	);
	return false;
};
