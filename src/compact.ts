import { MailspringMessage, MailspringThread } from 'mailspring-exports';

/**
 * A thread reduced to what a triage caller actually needs.
 *
 * The enriched shape carries participants, snippets, folders, labels and
 * attachment records, which pushes a page of 100 threads past a client's
 * response cap — so the documented limit of 500 is unreachable and callers fall
 * back to reading the database. This keeps a row to a handful of scalars.
 */
export interface CompactThread
{
	id: string;
	accountId: string;
	from: string;
	subject: string;
	date: string;
	unread: boolean;
	messageCount?: number;
	messageSubjects?: string[];
}

export function compactFrom(messages: MailspringMessage[]): string
{
	const last = messages[messages.length - 1];
	const from = (last && last.from && last.from[0]) || null;
	return from ? from.email : '';
}

export function toCompact(
	thread: MailspringThread,
	messages?: MailspringMessage[],
	includeMessageSubjects = false,
): CompactThread
{
	const row: CompactThread = {
		id: thread.id,
		accountId: (thread as unknown as { accountId: string }).accountId,
		from: messages ? compactFrom(messages) : '',
		subject: thread.subject || '',
		date: new Date(thread.lastMessageReceivedTimestamp).toISOString(),
		unread: !!thread.unread,
	};

	if (messages)
	{
		row.messageCount = messages.length;

		// Every subject in the thread, not just the newest. Classifying a GitHub
		// thread as pure-CI versus one carrying real review comments needs all of
		// them — the newest alone gets it wrong.
		if (includeMessageSubjects)
		{
			row.messageSubjects = messages.map(message => message.subject || '');
		}
	}

	return row;
}

/** Group messages by their thread id, preserving the order they arrive in. */
export function groupByThread(messages: MailspringMessage[]): Map<string, MailspringMessage[]>
{
	const byThread = new Map<string, MailspringMessage[]>();

	messages.forEach((message) =>
	{
		const list = byThread.get(message.threadId);
		if (list) list.push(message);
		else byThread.set(message.threadId, [message]);
	});

	return byThread;
}
