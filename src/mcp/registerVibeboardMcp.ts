import * as vscode from 'vscode';

import { logDiskError } from '../host/hostFs';
import {
	VIBEBOARD_MCP_SERVER_NAME,
	VIBEBOARD_WORKSPACE_ROOT_ENV,
	VIBEBOARD_WORKSPACE_ROOTS_ENV,
} from './mcpIdentity';

type RegisterVibeboardMcpArgs = {
	context: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
};

let mcpRegistration: vscode.Disposable | undefined;
let mcpDisposeHooked = false;

const disposeMcpRegistration = (): void => {
	if (mcpRegistration === undefined) {
		return;
	}
	mcpRegistration.dispose();
	mcpRegistration = undefined;
};

export const registerVibeboardMcp = ({
	context,
	outputChannel,
}: RegisterVibeboardMcpArgs): boolean => {
	disposeMcpRegistration();

	if (!mcpDisposeHooked) {
		context.subscriptions.push({
			dispose: disposeMcpRegistration,
		});
		mcpDisposeHooked = true;
	}

	if (!vscode.workspace.isTrusted) {
		outputChannel.appendLine('Workspace is untrusted. MCP server was not registered.');
		return false;
	}

	const mcpApi = vscode.cursor?.mcp;
	if (!mcpApi) {
		outputChannel.appendLine(
			'vscode.cursor.mcp is unavailable. MCP server was not registered. Open this extension in Cursor.',
		);
		return false;
	}

	const mcpJsUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp.js');
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	const workspaceRootOrEmpty = workspaceFolders[0]?.uri.fsPath ?? '';

	const unregisterVibeboardMcpServer = (): void => {
		try {
			mcpApi.unregisterServer(VIBEBOARD_MCP_SERVER_NAME);
		} catch (error: unknown) {
			logDiskError({ scope: 'unregisterVibeboardMcp', error, outputChannel });
		}
	};

	unregisterVibeboardMcpServer();

	try {
		mcpApi.registerServer({
			name: VIBEBOARD_MCP_SERVER_NAME,
			server: {
				command: process.execPath,
				args: [mcpJsUri.fsPath],
				env: {
					ELECTRON_RUN_AS_NODE: '1',
					[VIBEBOARD_WORKSPACE_ROOT_ENV]: workspaceRootOrEmpty,
					[VIBEBOARD_WORKSPACE_ROOTS_ENV]: JSON.stringify(
						workspaceFolders.map((folder) => folder.uri.fsPath),
					),
				},
			},
		});
	} catch (error: unknown) {
		logDiskError({ scope: 'registerVibeboardMcp', error, outputChannel });
		void vscode.window.showErrorMessage(
			'Could not register the Vibeboard MCP server. Check the Output panel: Vibeboard.',
		);
		return false;
	}

	mcpRegistration = {
		dispose: unregisterVibeboardMcpServer,
	};
	return true;
};
