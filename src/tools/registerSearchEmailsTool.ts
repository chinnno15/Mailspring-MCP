import { DatabaseStore, Thread } from 'mailspring-exports';
import { z } from 'zod';

import { buildThreadMatchers, compactThreads, enrichThread, filterThreadsByParticipant, json } from '../helpers';
import { SearchEmailsParams, ToolServer } from '../types';

const searchEmailsDescription = 'Search emails with full-text search and optional structured filters. The query field supports FTS5 syntax: use OR for alternatives (interview OR callback), quoted phrases for exact match ("phone screen"), prefix matching (sched*), and NOT to exclude terms. Combine with structured filters for precise results.';

const searchEmailsInputSchema = {
	query: z.string().optional().describe('Full-text search query (supports FTS5: OR, NOT, quoted phrases, prefix*)'),
	from: z.string().optional().describe('Filter by sender email or name (partial match)'),
	to: z.string().optional().describe('Filter by recipient email or name (partial match)'),
	subject: z.string().optional().describe('Filter by subject (partial match)'),
	dateFrom: z.string().optional().describe("Start date (ISO 8601, e.g. '2026-03-01')"),
	dateTo: z.string().optional().describe("End date (ISO 8601, e.g. '2026-03-29')"),
	unread: z.boolean().optional().describe('Filter by unread status'),
	starred: z.boolean().optional().describe('Filter by starred status'),
	hasAttachment: z.boolean().optional().describe('Filter for emails with attachments'),
	folder: z.string().optional().describe("Filter by folder path (e.g. 'INBOX')"),
	label: z.string().optional().describe('Filter by label path'),
	limit: z.number().default(50).describe('Max results (1-500)'),
	compact: z.boolean().default(false).describe('Return only {id, accountId, from, subject, date, unread, messageCount} — far smaller, so large pages fit in a response'),
	includeMessageSubjects: z.boolean().default(false).describe('With compact, also return every message subject in each thread'),
	offset: z.number().default(0).describe('Offset for pagination'),
};

async function handleSearchEmails(params: SearchEmailsParams)
{
	const matchers = await buildThreadMatchers(params);
	let q = DatabaseStore.findAll(Thread);

	if (params.query)
	{
		q = q.search(params.query);
	}
	if (params.subject)
	{
		matchers.push(Thread.attributes.subject.like(params.subject));
	}
	if (matchers.length)
	{
		q = q.where(matchers);
	}

	let threads = await q
		.order(Thread.attributes.lastMessageReceivedTimestamp.descending())
		.limit(params.limit)
		.offset(params.offset);

	if (params.from || params.to)
	{
		threads = filterThreadsByParticipant(threads, params.from, params.to);
	}
	if (params.hasAttachment !== undefined)
	{
		threads = threads.filter(thread => params.hasAttachment ? thread.attachmentCount > 0 : thread.attachmentCount === 0);
	}

	if (params.compact)
	{
		return json(await compactThreads(threads, !!params.includeMessageSubjects));
	}

	return json(await Promise.all(threads.map(enrichThread)));
}

export function registerSearchEmailsTool(server: ToolServer): void
{
	server.registerTool('search_emails', { description: searchEmailsDescription, inputSchema: searchEmailsInputSchema }, handleSearchEmails);
}