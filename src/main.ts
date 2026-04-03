import http from 'http';
import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { registerTools } from './tools';

const MCP_PORT = 2525;
let httpServer: http.Server | null = null;

export function activate()
{
	const mcpServer = new McpServer({ name: 'mailspring', version: '2.0.0' });

	registerTools(mcpServer);
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });

	httpServer = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) =>
	{
		await transport.handleRequest(req, res);
	});

	httpServer.on('error', (err: NodeJS.ErrnoException) =>
	{
		if (err.code === 'EADDRINUSE')
		{
			console.log('[mailspring-mcp] Port already in use, server likely running in another window');
			return;
		}
		console.error('[mailspring-mcp] Server error:', err);
	});

	mcpServer.connect(transport);

	httpServer.listen(MCP_PORT, '127.0.0.1', () =>
	{
		console.log(`[mailspring-mcp] MCP server listening on http://127.0.0.1:${MCP_PORT}/mcp`);
	});
}

export function serialize() { }

export function deactivate()
{
	if (httpServer)
	{
		httpServer.close();
		httpServer = null;
	}
}
