import { McpServer } from '@modelcontextprotocol/server';
import { join } from 'node:path';

import { readAgentInstructions } from './agentInstructions';
import { registerArtboardTools } from './artboardTools';
import { registerCommentTools } from './commentTools';
import { VIBEBOARD_MCP_SERVER_NAME } from './mcpIdentity';
import { registerPageTools } from './pageTools';

// `bundleDir` is the folder holding dist/mcp.js; skills/ sits beside it in the extension root.
export const createVibeboardMcpServer = (bundleDir: string): McpServer => {
	const server = new McpServer(
		{
			name: VIBEBOARD_MCP_SERVER_NAME,
			version: process.env.VIBEBOARD_VERSION ?? '0.0.0',
		},
		{ instructions: readAgentInstructions(join(bundleDir, '..')) },
	);
	registerArtboardTools(server);
	registerCommentTools(server);
	registerPageTools(server);
	return server;
};
