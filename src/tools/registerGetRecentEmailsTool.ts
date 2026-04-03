import { DatabaseStore, Message } from 'mailspring-exports';
import { z } from 'zod';

import { formatMessage, json } from '../helpers';
import { GetRecentEmailsParams, ToolServer } from '../types';

const getRecentEmailsDescription = 'Get recent emails with optional date range filtering and pagination.';

const getRecentEmailsInputSchema = {
	limit: z.number().default(50).describe('Max number of results to return'),
	offset: z.number().default(0).describe('Offset for pagination'),
	dateFrom: z.string().optional().describe('Only emails after this date (ISO 8601)'),
	dateTo: z.string().optional().describe('Only emails before this date (ISO 8601)'),
};

async function handleGetRecentEmails({ limit, offset, dateFrom, dateTo }: GetRecentEmailsParams)
{
	const matchers = [Message.attributes.draft.equal(false)];

	if (dateFrom)
	{
		matchers.push(Message.attributes.date.greaterThanOrEqualTo(new Date(dateFrom)));
	}
	if (dateTo)
	{
		matchers.push(Message.attributes.date.lessThanOrEqualTo(new Date(dateTo)));
	}

	const messages = await DatabaseStore.findAll(Message)
		.where(matchers)
		.order(Message.attributes.date.descending())
		.limit(limit)
		.offset(offset);

	return json(messages.map(formatMessage));
}

export function registerGetRecentEmailsTool(server: ToolServer): void
{
	server.registerTool('get_recent_emails', { description: getRecentEmailsDescription, inputSchema: getRecentEmailsInputSchema }, handleGetRecentEmails);
}