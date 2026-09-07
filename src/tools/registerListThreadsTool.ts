import { DatabaseStore, Thread } from 'mailspring-exports';
import { z } from 'zod';

import { buildThreadMatchers, compactThreads, enrichThread, json } from '../helpers';
import { ListThreadsParams, ToolServer } from '../types';

const listThreadsDescription = 'List email threads with filters for folder, label, unread/starred status, date range, and attachments. Returns enriched thread metadata by default; pass compact:true for a much smaller row shape that allows large pages.';

const listThreadsInputSchema = {
	folder: z.string().optional().describe("Filter by folder path (e.g. 'INBOX', 'Sent Mail')"),
	label: z.string().optional().describe('Filter by label path'),
	unread: z.boolean().optional().describe('Filter by unread status'),
	starred: z.boolean().optional().describe('Filter by starred status'),
	hasAttachment: z.boolean().optional().describe('Filter for threads with attachments'),
	dateFrom: z.string().optional().describe('Only threads with messages after this date (ISO 8601)'),
	dateTo: z.string().optional().describe('Only threads with messages before this date (ISO 8601)'),
	limit: z.number().default(25).describe('Max results (1-500)'),
	compact: z.boolean().default(false).describe('Return only {id, accountId, from, subject, date, unread, messageCount} — far smaller, so large pages fit in a response'),
	includeMessageSubjects: z.boolean().default(false).describe('With compact, also return every message subject in each thread (needed to classify a thread by its whole history, not just its newest message)'),
	offset: z.number().default(0).describe('Offset for pagination'),
};

async function handleListThreads(params: ListThreadsParams)
{
	const matchers = await buildThreadMatchers(params);
	let query = DatabaseStore.findAll(Thread);

	if (matchers.length)
	{
		query = query.where(matchers);
	}

	let threads = await query
		.order(Thread.attributes.lastMessageReceivedTimestamp.descending())
		.limit(params.limit)
		.offset(params.offset);

	if (!!params.hasAttachment)
	{
		threads = threads.filter(thread => thread.attachmentCount > 0);
	}

	if (params.compact)
	{
		return json(await compactThreads(threads, !!params.includeMessageSubjects));
	}

	const results = await Promise.all(threads.map(enrichThread));

	return json(results);
}

export function registerListThreadsTool(server: ToolServer): void
{
	server.registerTool('list_threads', { description: listThreadsDescription, inputSchema: listThreadsInputSchema }, handleListThreads);
}