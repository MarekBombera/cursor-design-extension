import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { registerArtboardTools } from './artboardTools';
import { registerCommentTools } from './commentTools';
import { VIBEBOARD_MCP_SERVER_NAME } from './mcpIdentity';
import { registerPageTools } from './pageTools';

const startVibeboardMcpServer = async (): Promise<void> => {
	const server = new McpServer({
		name: VIBEBOARD_MCP_SERVER_NAME,
		version: process.env.VIBEBOARD_VERSION ?? '0.0.0',
	});
	registerArtboardTools(server);
	registerCommentTools(server);
	registerPageTools(server);
	const transport = new StdioServerTransport();
	await server.connect(transport);
};

void startVibeboardMcpServer().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : 'Unknown MCP server error';
	process.stderr.write(`vibeboard MCP: ${message}\n`);
	process.exit(1);
});
