export interface GrepContact
{
	name?: string;
	email: string;
}

export interface GrepMessage
{
	threadId: string;
	subject?: string;
	body?: string;
	from?: GrepContact[];
}

export type GrepField = 'body' | 'subject' | 'from';

export interface GrepOptions
{
	regex: RegExp;
	/** When set, only messages whose From header matches are considered at all. */
	senderRegex?: RegExp;
	fields: GrepField[];
	sampleLength: number;
}

export interface GrepHit
{
	matches: number;
	sample?: string;
}

export function fromText(message: GrepMessage): string
{
	return (message.from || []).map(contact => `${contact.name || ''} <${contact.email}>`).join(' ');
}

function textFor(message: GrepMessage, fields: GrepField[]): string
{
	const parts: string[] = [];
	if (fields.includes('body')) parts.push(message.body || '');
	if (fields.includes('subject')) parts.push(message.subject || '');
	if (fields.includes('from')) parts.push(fromText(message));
	return parts.join('\n');
}

/**
 * True when the sender regex matches any From contact, tried against the bare
 * address and against "Name <address>".
 *
 * Matching only the rendered header would make an anchored pattern like
 * `^bot@forge\.example$` fail on the trailing `>`, which is the first thing a
 * caller writing an address filter reaches for.
 */
export function senderMatches(message: GrepMessage, regex: RegExp): boolean
{
	return (message.from || []).some(contact =>
		regex.test(contact.email || '') || regex.test(`${contact.name || ''} <${contact.email}>`));
}

/** A global copy for counting, since a caller's own 'g' flag would make test() stateful. */
function withGlobal(regex: RegExp): RegExp
{
	return new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
}

function withoutGlobal(regex: RegExp): RegExp
{
	return new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''));
}

function excerpt(text: string, regex: RegExp, length: number): string
{
	const at = text.search(withoutGlobal(regex));
	const start = Math.max(0, at - Math.floor(length / 2));
	return text.slice(start, start + length).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fold a batch of messages into per-thread hits.
 *
 * The sender filter is applied per message, so "mail from X that says Y" needs
 * one message satisfying both. Filtering senders and bodies in two separate
 * passes would match a thread where X wrote one message and someone else wrote
 * the one containing Y.
 */
export function accumulateHits(hits: Map<string, GrepHit>, messages: GrepMessage[], options: GrepOptions): void
{
	const sender = options.senderRegex ? withoutGlobal(options.senderRegex) : null;
	const counter = withGlobal(options.regex);

	messages.forEach((message) =>
	{
		if (sender && !senderMatches(message, sender)) return;

		const text = textFor(message, options.fields);
		if (!text) return;

		const found = text.match(counter);
		if (!found || !found.length) return;

		const entry = hits.get(message.threadId) || { matches: 0 };
		entry.matches += found.length;

		if (options.sampleLength > 0 && !entry.sample)
		{
			entry.sample = excerpt(text, options.regex, options.sampleLength);
		}

		hits.set(message.threadId, entry);
	});
}

export function chunk<T>(items: T[], size: number): T[][]
{
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
