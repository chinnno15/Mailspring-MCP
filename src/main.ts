import http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { isAuthorized, loadOrCreateToken, tokenPath } from './auth';
import { registerTools } from './tools';

const MCP_HOST = '127.0.0.1';
const MCP_PORT = 2525;

const ALLOWED_HOSTS = [`127.0.0.1:${MCP_PORT}`, `localhost:${MCP_PORT}`, `[::1]:${MCP_PORT}`];

// A non-browser client sends no Origin and is unaffected; a browser always sends
// one on a cross-origin request, so anything not from loopback is turned away.
const ALLOWED_ORIGINS = [`http://127.0.0.1:${MCP_PORT}`, `http://localhost:${MCP_PORT}`];

let httpServer: http.Server | null = null;

function unauthorized(res: http.ServerResponse)
{
	res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="mailspring-mcp"' });
	res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }));
}

export function activate()
{
	// The server binds loopback, but loopback is not a trust boundary: every
	// local process can reach it. Requests must present the shared token, which
	// is generated on first run into the Mailspring config dir at mode 0600.
	const token = loadOrCreateToken(AppEnv.getConfigDirPath());

	httpServer = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) =>
	{
		if (!isAuthorized(req.headers.authorization, token))
		{
			unauthorized(res);
			return;
		}

		// Stateless: a fresh server + transport per request, so any number of
		// clients can connect over the life of the app. A single shared transport
		// accepts only one initialize and rejects every later client with
		// "Server already initialized".
		const mcpServer = new McpServer({ name: 'mailspring', version: '2.0.0' });
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableDnsRebindingProtection: true,
			allowedHosts: ALLOWED_HOSTS,
			allowedOrigins: ALLOWED_ORIGINS,
		});

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

	httpServer.listen(MCP_PORT, MCP_HOST, () =>
	{
		console.log(`[mailspring-mcp] MCP server listening on http://${MCP_HOST}:${MCP_PORT}/mcp`);
		console.log(`[mailspring-mcp] Token: ${tokenPath(AppEnv.getConfigDirPath())}`);
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
