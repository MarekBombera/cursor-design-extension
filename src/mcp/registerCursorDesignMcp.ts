import { existsSync } from 'node:fs';

import * as vscode from 'vscode';

import { CURSOR_DESIGN_MCP_SERVER_NAME, CURSOR_DESIGN_WORKSPACE_ROOT_ENV } from './mcpIdentity';

type RegisterCursorDesignMcpArgs = {
	context: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
};

export const registerCursorDesignMcp = ({
	context,
	outputChannel,
}: RegisterCursorDesignMcpArgs): void => {
	const mcpApi = vscode.cursor?.mcp;
	if (!mcpApi) {
		outputChannel.appendLine(
			'vscode.cursor.mcp is unavailable. MCP server was not registered. Open this extension in Cursor.',
		);
		return;
	}

	// ponytail: first folder only; ambiguous_workspace is Phase 2
	const workspaceRootOrEmpty = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
	const mcpJsPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp.js').fsPath;
	if (!existsSync(mcpJsPath)) {
		outputChannel.appendLine('dist/mcp.js is missing. Compile the extension before testing MCP.');
	}

	try {
		mcpApi.unregisterServer(CURSOR_DESIGN_MCP_SERVER_NAME);
	} catch (error: unknown) {
		outputChannel.appendLine(
			`unregisterCursorDesignMcp: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
		);
	}

	try {
		mcpApi.registerServer({
			name: CURSOR_DESIGN_MCP_SERVER_NAME,
			server: {
				command: process.execPath,
				args: [mcpJsPath],
				env: {
					ELECTRON_RUN_AS_NODE: '1',
					[CURSOR_DESIGN_WORKSPACE_ROOT_ENV]: workspaceRootOrEmpty,
				},
			},
		});
	} catch (error: unknown) {
		outputChannel.appendLine(
			`registerCursorDesignMcp: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
		);
		void vscode.window.showErrorMessage(
			'Could not register the Cursor Design MCP server. Check the Output panel: Cursor Design.',
		);
		return;
	}

	context.subscriptions.push({
		dispose: (): void => {
			try {
				mcpApi.unregisterServer(CURSOR_DESIGN_MCP_SERVER_NAME);
			} catch (error: unknown) {
				// ponytail: dispose must not throw; Cursor may already have dropped the server
				outputChannel.appendLine(
					`unregisterCursorDesignMcp: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
				);
			}
		},
	});
};
