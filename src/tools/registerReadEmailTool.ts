import { DatabaseStore, Message } from 'mailspring-exports';
import { z } from 'zod';

import { formatMessage, json, stripHtml, text } from '../helpers';
import { ReadByIdParams, ToolServer } from '../types';

const readEmailDescription = 'Read a specific email by its ID, including the full body content and attachment list.';

const readEmailInputSchema = {
	id: z.string().describe('The message ID'),
};

async function handleReadEmail({ id }: ReadByIdParams)
{
	const message = await DatabaseStore.find(Message, id)
		.include(Message.attributes.body);
	if (!message)
	{
		return text('Message not found.');
	}
	return json({
		...formatMessage(message),
		body: stripHtml(message.body || ''),
	});
}

export function registerReadEmailTool(server: ToolServer): void
{
	server.registerTool('read_email', { description: readEmailDescription, inputSchema: readEmailInputSchema }, handleReadEmail);
}