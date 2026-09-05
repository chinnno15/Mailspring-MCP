import http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { registerTools } from './tools';

const MCP_PORT = 2525;
let httpServer: http.Server | null = null;

export function activate()
{
	httpServer = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) =>
	{
		// Stateless: a fresh server + transport per request, so any number of
		// clients can connect over the life of the app. A single shared transport
		// accepts only one initialize and rejects every later client with
		// "Server already initialized".
		const mcpServer = new McpServer({ name: 'mailspring', version: '2.0.0' });
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

		res.on('close', () =>
		{
			transport.close();
			mcpServer.close();
		});

		try
		{
			registerTools(mcpServer);
			await mcpServer.connect(transport);
			await transport.handleRequest(req, res);
		}
		catch (err)
		{
			console.error('[mailspring-mcp] Request error:', err);
			if (!res.headersSent)
			{
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
			}
		}
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
