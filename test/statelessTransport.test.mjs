// Regression test for the single-transport bug: the plugin used to build ONE
// StreamableHTTPServerTransport at activate(), so the first client to
// initialize held it forever and every later client got
// "Invalid Request: Server already initialized". Each request now gets a fresh
// server + transport, so repeated clients must all succeed.
//
// Integration test: needs Mailspring running with the plugin loaded. Skips otherwise.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const URL = 'http://127.0.0.1:2525/mcp';

const readToken = () =>
{
	const file = path.join(os.homedir(), '.config', 'Mailspring', 'mailspring-mcp-token');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
};
const TOKEN = readToken();

const HEADERS = {
	'Content-Type': 'application/json',
	Accept: 'application/json, text/event-stream',
	...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

const reachable = () => new Promise((resolve) =>
{
	const sock = net.connect({ host: '127.0.0.1', port: 2525 });
	sock.setTimeout(1000);
	sock.on('connect', () => { sock.destroy(); resolve(true); });
	sock.on('error', () => resolve(false));
	sock.on('timeout', () => { sock.destroy(); resolve(false); });
});

async function rpc(body, headers = HEADERS)
{
	const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(body) });
	const text = await res.text();
	const line = text.split('\n').map(l => (l.startsWith('data: ') ? l.slice(6) : l)).find(l => l.startsWith('{'));
	return { status: res.status, payload: line ? JSON.parse(line) : null };
}

const initialize = () => rpc({
	jsonrpc: '2.0', id: 1, method: 'initialize',
	params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
});

describe('stateless transport', { skip: !(await reachable()) && 'Mailspring MCP not listening on 2525' }, () =>
{
	it('accepts repeated initialize calls from independent clients', async () =>
	{
		for (let i = 0; i < 4; i += 1)
		{
			const { status, payload } = await initialize();
			assert.equal(status, 200, `client ${i + 1} got HTTP ${status}`);
			assert.equal(payload?.error, undefined, `client ${i + 1}: ${JSON.stringify(payload?.error)}`);
			assert.equal(payload?.result?.serverInfo?.name, 'mailspring');
		}
	});

	it('never answers with "Server already initialized"', async () =>
	{
		await initialize();
		const { payload } = await initialize();
		assert.ok(!JSON.stringify(payload).includes('already initialized'), 'the single-transport bug is back');
	});

	it('exposes the mutation tools alongside the read tools', async () =>
	{
		const { payload } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
		const names = (payload?.result?.tools ?? []).map(t => t.name);
		for (const tool of ['search_emails', 'read_thread', 'archive_threads', 'trash_threads'])
		{
			assert.ok(names.includes(tool), `missing tool: ${tool}`);
		}
	});

	it('rejects an over-size batch at the schema boundary', async () =>
	{
		const threadIds = Array.from({ length: 201 }, (_, i) => `t${i}`);
		const { payload } = await rpc({
			jsonrpc: '2.0', id: 3, method: 'tools/call',
			params: { name: 'trash_threads', arguments: { threadIds } },
		});
		const body = JSON.stringify(payload);
		assert.ok(payload?.error || payload?.result?.isError, `expected rejection, got: ${body.slice(0, 200)}`);
	});

	it('rejects a request with no Authorization header', async () =>
	{
		const { 'Authorization': _drop, ...anonymous } = HEADERS;
		const { status } = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, anonymous);
		assert.equal(status, 401, 'an unauthenticated local process must not reach the tools');
	});

	it('rejects a request bearing the wrong token', async () =>
	{
		const { status } = await rpc(
			{ jsonrpc: '2.0', id: 10, method: 'tools/list' },
			{ ...HEADERS, Authorization: `Bearer ${'0'.repeat(64)}` },
		);
		assert.equal(status, 401);
	});

	// fetch() forbids setting Host, so these go through node:http directly.
	const raw = (headers) => new Promise((resolve, reject) =>
	{
		const body = JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/list' });
		const req = http.request(
			{ host: '127.0.0.1', port: 2525, path: '/mcp', method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } },
			(res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); },
		);
		req.on('error', reject);
		req.end(body);
	});

	it('rejects a forged Host header (DNS rebinding protection)', async () =>
	{
		assert.equal(await raw({ ...HEADERS, Host: 'evil.example.com' }), 403);
	});

	it('serves a correct Host header', async () =>
	{
		assert.equal(await raw({ ...HEADERS, Host: '127.0.0.1:2525' }), 200);
	});

	it('rejects a cross-site Origin', async () =>
	{
		assert.equal(await raw({ ...HEADERS, Origin: 'https://evil.example.com' }), 403);
	});

	it('still serves a client that sends no Origin at all', async () =>
	{
		assert.equal(await raw(HEADERS), 200);
	});

	it('reports unknown thread ids as missing without queueing anything', async () =>
	{
		const { payload } = await rpc({
			jsonrpc: '2.0', id: 4, method: 'tools/call',
			params: { name: 'trash_threads', arguments: { threadIds: ['t:definitely-not-a-real-thread-id'] } },
		});
		const result = JSON.parse(payload.result.content[0].text);
		assert.deepEqual(result, {
			requested: 1, matched: 0, trashed: 0, tasksQueued: 0,
			missing: ['t:definitely-not-a-real-thread-id'],
		});
	});
});
