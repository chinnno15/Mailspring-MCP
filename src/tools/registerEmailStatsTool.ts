import { Contact, DatabaseStore, Folder, Label, Message, Thread } from 'mailspring-exports';

import { json } from '../helpers';
import { ToolServer } from '../types';

const emailStatsDescription = 'Get mailbox statistics including total messages, threads, contacts, folders, labels, and unread thread count.';

async function handleEmailStats()
{
	const [messages, threads, contacts, folders, labels, unread] = await Promise.all([
		DatabaseStore.findAll(Message).count(),
		DatabaseStore.findAll(Thread).count(),
		DatabaseStore.findAll(Contact).count(),
		DatabaseStore.findAll(Folder).count(),
		DatabaseStore.findAll(Label).count(),
		DatabaseStore.findAll(Thread).where([Thread.attributes.unread.equal(true)]).count(),
	]);

	return json({ messages, threads, contacts, folders, labels, unreadThreads: unread });
}

export function registerEmailStatsTool(server: ToolServer): void
{
	server.registerTool('email_stats', { description: emailStatsDescription }, handleEmailStats);
}