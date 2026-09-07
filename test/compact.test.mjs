import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compactFrom, groupByThread, toCompact } from '../lib/compact.js';

const msg = (id, threadId, subject, email) => ({
	id, threadId, subject,
	from: email ? [{ email, name: 'X' }] : [],
});

const thread = (over = {}) => ({
	id: 't1', accountId: 'acct1', subject: 'Subject', unread: true,
	lastMessageReceivedTimestamp: Date.UTC(2026, 8, 1), ...over,
});

describe('toCompact', () =>
{
	it('projects only the scalar fields', () =>
	{
		const row = toCompact(thread(), [msg('m1', 't1', 'Subject', 'a@b.c')]);

		assert.deepEqual(Object.keys(row).sort(), ['accountId', 'date', 'from', 'id', 'messageCount', 'subject', 'unread']);
		assert.equal(row.id, 't1');
		assert.equal(row.accountId, 'acct1');
		assert.equal(row.unread, true);
	});

	it('omits participants, snippets, folders, labels and attachments', () =>
	{
		const heavy = thread({ snippet: 'x'.repeat(500), participants: [1, 2, 3], folders: [{}], labels: [{}], attachmentCount: 4 });
		const row = toCompact(heavy, [msg('m1', 't1', 'S', 'a@b.c')]);

		for (const key of ['snippet', 'plaintext', 'participants', 'folders', 'labels', 'attachments', 'hasAttachments'])
		{
			assert.ok(!(key in row), `compact row must not carry ${key}`);
		}
	});

	it('takes from off the newest message, not the first', () =>
	{
		const row = toCompact(thread(), [msg('m1', 't1', 'S', 'first@x.com'), msg('m2', 't1', 'S', 'last@x.com')]);
		assert.equal(row.from, 'last@x.com');
	});

	it('emits an ISO date', () =>
	{
		assert.equal(toCompact(thread()).date, '2026-09-01T00:00:00.000Z');
	});

	it('returns every message subject when asked', () =>
	{
		const msgs = [msg('m1', 't1', '[repo] Run failed: CI'), msg('m2', 't1', 'Re: [repo] real comment')];
		const row = toCompact(thread(), msgs, true);

		assert.deepEqual(row.messageSubjects, ['[repo] Run failed: CI', 'Re: [repo] real comment']);
		assert.equal(row.messageCount, 2);
	});

	it('omits messageSubjects unless requested — the whole point is a small row', () =>
	{
		assert.ok(!('messageSubjects' in toCompact(thread(), [msg('m1', 't1', 'S', 'a@b.c')])));
	});

	it('survives a thread with no messages loaded', () =>
	{
		const row = toCompact(thread());
		assert.equal(row.from, '');
		assert.ok(!('messageCount' in row));
	});

	it('handles a message with no sender', () =>
	{
		assert.equal(toCompact(thread(), [msg('m1', 't1', 'S', null)]).from, '');
	});

	it('is dramatically smaller than the enriched shape', () =>
	{
		const heavy = thread({ snippet: 'x'.repeat(300), participants: Array(8).fill({ email: 'a@b.c', name: 'Someone' }), folders: [{ path: 'INBOX' }], labels: [{ path: 'L' }] });
		const compactSize = JSON.stringify(toCompact(heavy, [msg('m1', 't1', 'S', 'a@b.c')])).length;
		assert.ok(compactSize < 250, `compact row unexpectedly large: ${compactSize} bytes`);
	});
});

describe('compactFrom', () =>
{
	it('returns empty for no messages', () => assert.equal(compactFrom([]), ''));
	it('reads the last sender', () => assert.equal(compactFrom([msg('m1', 't', 'S', 'z@z.z')]), 'z@z.z'));
});

describe('groupByThread', () =>
{
	it('groups and preserves order', () =>
	{
		const g = groupByThread([msg('m1', 't1', 'a'), msg('m2', 't2', 'b'), msg('m3', 't1', 'c')]);

		assert.equal(g.size, 2);
		assert.deepEqual(g.get('t1').map(m => m.id), ['m1', 'm3']);
		assert.deepEqual(g.get('t2').map(m => m.id), ['m2']);
	});

	it('returns an empty map for no messages', () => assert.equal(groupByThread([]).size, 0));
});
