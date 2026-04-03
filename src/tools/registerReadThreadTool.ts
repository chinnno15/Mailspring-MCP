import { AccountStore, DatabaseStore, Message, Thread } from 'mailspring-exports';
import { z } from 'zod';

import { formatMessage, formatThread, json, sanitizeHtml, stripHtml, text } from '../helpers';
import { ReadByIdParams, ToolServer } from '../types';

const readThreadDescription = 'Read a full email thread with all messages, body content, attachments, and reply status.';

const readThreadInputSchema = {
	id: z.string().describe('The thread ID'),
};

async function handleReadThread({ id }: ReadByIdParams)
{
	const thread = await DatabaseStore.find(Thread, id);
	if (!thread)
	{
		return text('Thread not found.');
	}

	const threadMessages = await thread.messages({ includeHidden: false });
	const messages = await Promise.all(threadMessages.map(async message =>
	{
		const fullMessage = await DatabaseStore.find(Message, message.id).include(Message.attributes.body);
		if (fullMessage)
		{
			return fullMessage;
		}
		return message;
	}));
	const myAddresses = new Set(AccountStore.accounts().map(account => account.emailAddress.toLowerCase()));
	const lastMsg = messages[messages.length - 1];
	const youRepliedLast = lastMsg ? (lastMsg.from || []).some(contact => myAddresses.has(contact.email.toLowerCase())) : false;

	return json({
		...formatThread(thread),
		messageCount: messages.length,
		youRepliedLast,
		messages: messages.map(message => ({
			...formatMessage(message),
			bodyHtml: message.body ? sanitizeHtml(message.body) : null,
			body: stripHtml(message.body || ''),
		})),
	});
}

export function registerReadThreadTool(server: ToolServer): void
{
	server.registerTool('read_thread', { description: readThreadDescription, inputSchema: readThreadInputSchema }, handleReadThread);
}