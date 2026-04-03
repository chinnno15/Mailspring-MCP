import { DatabaseStore, Message } from 'mailspring-exports';
import { z } from 'zod';

import { formatMessage, json, stripHtml } from '../helpers';
import { BatchReadEmailsParams, ToolServer } from '../types';

const batchReadEmailsDescription = 'Read multiple emails at once by their IDs, including full body content and attachments. Use this to efficiently analyze or categorize a batch of emails instead of calling read_email repeatedly.';

const batchReadEmailsInputSchema = {
	ids: z.array(z.string()).describe('Array of message IDs to read'),
};

async function handleBatchReadEmails({ ids }: BatchReadEmailsParams)
{
	const results = await Promise.all(ids.map(async (id: string) =>
	{
		const message = await DatabaseStore
			.find(Message, id)
			.include(Message.attributes.body);

		if (!message)
		{
			return { id, error: 'not found' };
		}
		
		return {
			...formatMessage(message),
			body: stripHtml(message.body || ''),
		};
	}));

	return json(results);
}

export function registerBatchReadEmailsTool(server: ToolServer): void
{
	server.registerTool('batch_read_emails', { description: batchReadEmailsDescription, inputSchema: batchReadEmailsInputSchema }, handleBatchReadEmails);
}