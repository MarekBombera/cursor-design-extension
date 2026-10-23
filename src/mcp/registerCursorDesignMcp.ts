import * as vscode from 'vscode';

import { logDiskError } from '../host/hostFs';
import {
	CURSOR_DESIGN_MCP_SERVER_NAME,
	CURSOR_DESIGN_WORKSPACE_ROOT_ENV,
	CURSOR_DESIGN_WORKSPACE_ROOTS_ENV,
} from './mcpIdentity';

type RegisterCursorDesignMcpArgs = {
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

export const registerCursorDesignMcp = ({
	context,
	outputChannel,
}: RegisterCursorDesignMcpArgs): boolean => {
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

	const unregisterCursorDesignMcpServer = (): void => {
		try {
			mcpApi.unregisterServer(CURSOR_DESIGN_MCP_SERVER_NAME);
		} catch (error: unknown) {
			logDiskError({ scope: 'unregisterCursorDesignMcp', error, outputChannel });
		}
	};

	unregisterCursorDesignMcpServer();

	try {
		mcpApi.registerServer({
			name: CURSOR_DESIGN_MCP_SERVER_NAME,
			server: {
				command: process.execPath,
				args: [mcpJsUri.fsPath],
				env: {
					ELECTRON_RUN_AS_NODE: '1',
					[CURSOR_DESIGN_WORKSPACE_ROOT_ENV]: workspaceRootOrEmpty,
					[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV]: JSON.stringify(
						workspaceFolders.map((folder) => folder.uri.fsPath),
					),
				},
			},
		});
	} catch (error: unknown) {
		logDiskError({ scope: 'registerCursorDesignMcp', error, outputChannel });
		void vscode.window.showErrorMessage(
			'Could not register the Cursor Design MCP server. Check the Output panel: Cursor Design.',
		);
		return false;
	}

	mcpRegistration = {
		dispose: unregisterCursorDesignMcpServer,
	};
	return true;
};
