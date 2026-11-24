import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { logStderr } from '../disk/errors';

import { allowedWorkspaceRoots } from './resolveWorkspaceRoot';
import { createVibeboardMcpServer } from './vibeboardMcpServer';

const startVibeboardMcpServer = async (): Promise<void> => {
	const transport = new StdioServerTransport();
	const server = createVibeboardMcpServer(__dirname);
	// Resolve roots right after the handshake so stderr (the editor's MCP log) names the source.
	server.server.oninitialized = () => {
		allowedWorkspaceRoots(server).catch((error: unknown) => {
			logStderr('workspace roots', error);
		});
	};
	await server.connect(transport);
};

void startVibeboardMcpServer().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : 'Unknown MCP server error';
	process.stderr.write(`vibeboard MCP: ${message}\n`);
	process.exit(1);
});
