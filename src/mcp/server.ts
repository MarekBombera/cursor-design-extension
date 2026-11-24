import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { createVibeboardMcpServer } from './vibeboardMcpServer';

const startVibeboardMcpServer = async (): Promise<void> => {
	const transport = new StdioServerTransport();
	await createVibeboardMcpServer(__dirname).connect(transport);
};

void startVibeboardMcpServer().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : 'Unknown MCP server error';
	process.stderr.write(`vibeboard MCP: ${message}\n`);
	process.exit(1);
});
