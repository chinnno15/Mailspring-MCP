import { AccountStore, DatabaseStore, Folder, Label, MailspringContact, MailspringFile, MailspringMessage, MailspringThread, Thread } from 'mailspring-exports';
import sanitizeHtmlLib from 'sanitize-html';

import { ThreadFilterParams } from './types';

const htmlSanitizerOptions = {
	allowedTags: [
		'a',
		'abbr',
		'b',
		'blockquote',
		'br',
		'code',
		'div',
		'em',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'hr',
		'i',
		'li',
		'ol',
		'p',
		'pre',
		'span',
		'strong',
		'sub',
		'sup',
		'table',
		'tbody',
		'td',
		'th',
		'thead',
		'tr',
		'u',
		'ul',
	],
	allowedAttributes: {
		a: ['href', 'name', 'target', 'rel'],
	},
	allowedSchemes: ['http', 'https', 'mailto'],
	allowedSchemesAppliedToAttributes: ['href'],
	transformTags: {
		a: (tagName: string, attribs: Record<string, string>) =>
		{
			const sanitizedAttributes: Record<string, string> = { ...attribs, rel: 'noopener noreferrer' };
			if (sanitizedAttributes.href && !sanitizedAttributes.target)
			{
				sanitizedAttributes.target = '_blank';
			}
			return { tagName, attribs: sanitizedAttributes };
		},
	},
};

const htmlToTextSanitizerOptions = {
	allowedTags: [],
	allowedAttributes: {},
	parser: {
		decodeEntities: true,
	},
};

export async function buildThreadMatchers(params: ThreadFilterParams): Promise<any[]>
{
	const matchers: any[] = [];

	if (!!params.unread)
	{
		matchers.push(Thread.attributes.unread.equal(params.unread));
	}

	if (!!params.starred)
	{
		matchers.push(Thread.attributes.starred.equal(params.starred));
	}

	if (params.dateFrom)
	{
		matchers.push(Thread.attributes.lastMessageReceivedTimestamp.greaterThanOrEqualTo(new Date(params.dateFrom)));
	}

	if (params.dateTo)
	{
		matchers.push(Thread.attributes.lastMessageReceivedTimestamp.lessThanOrEqualTo(new Date(params.dateTo)));
	}

	if (params.folder)
	{
		const folders = await DatabaseStore.findAll(Folder);
		const match = folders.find(folder => folder.path.toLowerCase().includes(params.folder!.toLowerCase()));
		if (match)
		{
			matchers.push(Thread.attributes.categories.contains(match.id));
		}
	}

	if (params.label)
	{
		const labels = await DatabaseStore.findAll(Label);
		const match = labels.find(label => label.path.toLowerCase().includes(params.label!.toLowerCase()));
		if (match)
		{
			matchers.push(Thread.attributes.categories.contains(match.id));
		}
	}

	return matchers;
}

export function filterThreadsByParticipant(threads: MailspringThread[], from?: string, to?: string): MailspringThread[]
{
	return threads.filter(thread =>
	{
		const participants = thread.participants || [];
		if (from)
		{
			const fromQuery = from.toLowerCase();
			const hasFrom = participants.some(participant =>
				participant.email.toLowerCase().includes(fromQuery) ||
				(participant.name || '').toLowerCase().includes(fromQuery)
			);
			if (!hasFrom)
			{
				return false;
			}
		}
		if (to)
		{
			const toQuery = to.toLowerCase();
			const hasTo = participants.some(participant =>
				participant.email.toLowerCase().includes(toQuery) ||
				(participant.name || '').toLowerCase().includes(toQuery)
			);
			if (!hasTo)
			{
				return false;
			}
		}
		return true;
	});
}

export async function enrichThread(thread: MailspringThread)
{
	const messages = await thread.messages({ includeHidden: false });
	const myAddresses = new Set(AccountStore.accounts().map(account => account.emailAddress.toLowerCase()));
	
	const lastMsg = messages[messages.length - 1];
	const youRepliedLast = lastMsg ? (lastMsg.from || []).some(contact => myAddresses.has(contact.email.toLowerCase())) : false;
	const files = messages.flatMap(message => message.files || []);

	return {
		...formatThread(thread),
		messageCount: messages.length,
		youRepliedLast,
		attachments: files.length ? files.map(formatFile) : undefined,
	};
}

export function formatThread(thread: MailspringThread)
{
	return {
		id: thread.id,
		subject: thread.subject,
		plaintext: thread.snippet,
		lastMessage: new Date(thread.lastMessageReceivedTimestamp).toISOString(),
		participants: (thread.participants || []).map(formatContact),
		unread: !!thread.unread,
		starred: !!thread.starred,
		hasAttachments: !!thread.attachmentCount,
		folders: (thread.folders || []).map(folder => folder.path || folder.displayName),
		labels: (thread.labels || []).map(label => label.path || label.displayName),
	};
}

export function formatMessage(msg: MailspringMessage)
{
	const files = msg.files || [];
	return {
		id: msg.id,
		subject: msg.subject,
		date: new Date(msg.date).toISOString(),
		from: (msg.from || []).map(formatContact),
		to: (msg.to || []).map(formatContact),
		cc: msg.cc && msg.cc.length ? msg.cc.map(formatContact) : undefined,
		plaintext: msg.snippet,
		unread: msg.unread,
		starred: msg.starred,
		draft: msg.draft,
		threadId: msg.threadId,
		folder: msg.folder && msg.folder.path,
		hasAttachments: files.length > 0,
		attachments: files.length ? files.map(formatFile) : undefined,
	};
}

export function formatFile(file: MailspringFile)
{
	return {
		id: file.id,
		filename: file.filename,
		contentType: file.contentType,
		size: file.size,
	};
}

export function formatContact(contact: MailspringContact): string
{
	if (contact.name)
	{
		return `${contact.name} <${contact.email}>`;
	}
	return contact.email;
}

export function json(data: unknown)
{
	return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function text(msg: string)
{
	return { content: [{ type: 'text' as const, text: msg }] };
}

export function sanitizeHtml(html: string): string
{
	return sanitizeHtmlLib(html, htmlSanitizerOptions);
}

export function stripHtml(html: string): string
{
	return sanitizeHtmlLib(html, htmlToTextSanitizerOptions)
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}