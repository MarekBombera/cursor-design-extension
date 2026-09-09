import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { CURSOR_DESIGN_MCP_SERVER_NAME } from './mcpIdentity';

const startCursorDesignMcpServer = async (): Promise<void> => {
	const server = new McpServer({
		name: CURSOR_DESIGN_MCP_SERVER_NAME,
		version: '0.0.1',
	});
	const transport = new StdioServerTransport();
	await server.connect(transport);
};

void startCursorDesignMcpServer().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : 'Unknown MCP server error';
	process.stderr.write(`cursor-design MCP: ${message}\n`);
	process.exit(1);
});
