import { DatabaseStore, MailspringMessage, MailspringThread, Message, TaskQueue, Thread } from 'mailspring-exports';
import { z } from 'zod';

import { buildThreadMatchers, json } from '../helpers';
import { ThreadFilterParams, ToolServer } from '../types';

const MAX_SCOPE = 2000;
const MAX_HITS = 500;

// --------------------------------------------------------------------------
// count_threads
// --------------------------------------------------------------------------

const countDescription = 'Count threads matching a filter without fetching them. Same filters as list_threads. Returns totals overall and per account.';

const countInputSchema = {
	folder: z.string().optional().describe("Filter by folder path (e.g. 'INBOX')"),
	label: z.string().optional().describe('Filter by label path'),
	unread: z.boolean().optional().describe('Filter by unread status'),
	starred: z.boolean().optional().describe('Filter by starred status'),
	dateFrom: z.string().optional().describe('Only threads with messages after this date (ISO 8601)'),
	dateTo: z.string().optional().describe('Only threads with messages before this date (ISO 8601)'),
};

async function handleCount(params: ThreadFilterParams)
{
	const matchers = await buildThreadMatchers(params);
	let query = DatabaseStore.findAll(Thread);
	if (matchers.length) query = query.where(matchers);

	const threads = await query.limit(MAX_SCOPE);
	const byAccount: Record<string, number> = {};
	threads.forEach((thread) =>
	{
		const id = (thread as unknown as { accountId: string }).accountId;
		byAccount[id] = (byAccount[id] || 0) + 1;
	});

	return json({ total: threads.length, byAccount, capped: threads.length >= MAX_SCOPE ? MAX_SCOPE : undefined });
}

// --------------------------------------------------------------------------
// grep_threads
// --------------------------------------------------------------------------

const grepDescription = 'Regex search across message bodies, subjects and senders, returning matching thread IDs and match counts rather than content. Answers questions FTS cannot — "which threads mention @someone", "which of these read like recruiter mail". Scope it with threadIds or the same filters as list_threads.';

const grepInputSchema = {
	pattern: z.string().min(1).describe('JavaScript regular expression, applied case-insensitively unless flags say otherwise'),
	flags: z.string().default('i').describe("Regex flags (default 'i')"),
	fields: z.array(z.enum(['body', 'subject', 'from'])).default(['body']).describe('Which parts to search'),
	threadIds: z.array(z.string()).optional().describe('Restrict the search to these threads'),
	folder: z.string().optional().describe("Restrict by folder path (e.g. 'INBOX')"),
	label: z.string().optional().describe('Restrict by label path'),
	limit: z.number().default(200).describe('Max matching threads to return'),
	sampleLength: z.number().default(0).describe('Characters of surrounding text to return per thread (0 returns none)'),
};

interface GrepParams extends ThreadFilterParams
{
	pattern: string;
	flags: string;
	fields: ('body' | 'subject' | 'from')[];
	threadIds?: string[];
	limit: number;
	sampleLength: number;
}

function textFor(message: MailspringMessage, fields: GrepParams['fields']): string
{
	const parts: string[] = [];
	if (fields.includes('body')) parts.push((message as unknown as { body?: string }).body || '');
	if (fields.includes('subject')) parts.push(message.subject || '');
	if (fields.includes('from')) parts.push((message.from || []).map(c => `${c.name || ''} <${c.email}>`).join(' '));
	return parts.join('\n');
}

async function scopeThreadIds(params: GrepParams): Promise<string[]>
{
	if (params.threadIds && params.threadIds.length) return Array.from(new Set(params.threadIds));

	const matchers = await buildThreadMatchers(params);
	let query = DatabaseStore.findAll(Thread);
	if (matchers.length) query = query.where(matchers);

	const threads: MailspringThread[] = await query.limit(MAX_SCOPE);
	return threads.map(thread => thread.id);
}

async function handleGrep(params: GrepParams)
{
	let regex: RegExp;
	try
	{
		regex = new RegExp(params.pattern, params.flags);
	}
	catch (err)
	{
		return json({ error: `Invalid regular expression: ${(err as Error).message}` });
	}

	const ids = await scopeThreadIds(params);
	if (!ids.length) return json({ scanned: 0, matched: 0, threads: [] });

	const needBody = params.fields.includes('body');
	let query = DatabaseStore.findAll(Message).where([Message.attributes.threadId.in(ids)]);
	if (needBody) query = query.include(Message.attributes.body);
	const messages: MailspringMessage[] = await query;

	const hits = new Map<string, { matches: number; sample?: string }>();
	messages.forEach((message) =>
	{
		const text = textFor(message, params.fields);
		if (!text) return;

		const scan = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
		const found = text.match(scan);
		if (!found || !found.length) return;

		const entry = hits.get(message.threadId) || { matches: 0 };
		entry.matches += found.length;
		if (params.sampleLength > 0 && !entry.sample)
		{
			const at = text.search(regex);
			const start = Math.max(0, at - Math.floor(params.sampleLength / 2));
			entry.sample = text.slice(start, start + params.sampleLength).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
		}
		hits.set(message.threadId, entry);
	});

	const threads = Array.from(hits.entries())
		.map(([threadId, hit]) => ({ threadId, ...hit }))
		.sort((a, b) => b.matches - a.matches)
		.slice(0, Math.min(params.limit, MAX_HITS));

	return json({ scanned: ids.length, matched: hits.size, returned: threads.length, threads });
}

// --------------------------------------------------------------------------
// sync_status
// --------------------------------------------------------------------------

const syncDescription = 'Report Mailspring\'s pending task queue. archive_threads, trash_threads and unarchive_threads return once tasks are queued, not once they have synced to the provider — poll this until idle is true before treating a bulk change as landed.';

function handleSyncStatus()
{
	const pending = (TaskQueue.queue() || []) as { constructor?: { name?: string }; status?: string }[];
	const byType: Record<string, number> = {};

	pending.forEach((task) =>
	{
		const name = (task && task.constructor && task.constructor.name) || 'Unknown';
		byType[name] = (byType[name] || 0) + 1;
	});

	return json({ pending: pending.length, byType, idle: pending.length === 0 });
}

// --------------------------------------------------------------------------

export function registerCountThreadsTool(server: ToolServer): void
{
	server.registerTool('count_threads', { description: countDescription, inputSchema: countInputSchema }, handleCount);
}

export function registerGrepThreadsTool(server: ToolServer): void
{
	server.registerTool('grep_threads', { description: grepDescription, inputSchema: grepInputSchema }, handleGrep);
}

export function registerSyncStatusTool(server: ToolServer): void
{
	server.registerTool('sync_status', { description: syncDescription, inputSchema: {} }, handleSyncStatus);
}
