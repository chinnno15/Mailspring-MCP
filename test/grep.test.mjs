import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accumulateHits, chunk, fromText, senderMatches } from '../lib/grep.js';

const msg = (threadId, body, from = 'a@x.com', subject = '') => ({
	threadId, body, subject, from: [{ email: from, name: '' }],
});

const run = (messages, over = {}) =>
{
	const hits = new Map();
	accumulateHits(hits, messages, { regex: /needle/i, fields: ['body'], sampleLength: 0, ...over });
	return hits;
};

describe('accumulateHits', () =>
{
	it('counts matches per thread across messages', () =>
	{
		const hits = run([msg('t1', 'needle needle'), msg('t1', 'needle'), msg('t2', 'nothing')]);
		assert.equal(hits.get('t1').matches, 3);
		assert.ok(!hits.has('t2'));
	});

	it('is case-insensitive when the regex is', () =>
	{
		assert.equal(run([msg('t1', 'NEEDLE')]).get('t1').matches, 1);
	});

	it('honours a caller-supplied global flag without going stateful', () =>
	{
		// A shared /g regex keeps lastIndex between test() calls and skips matches.
		const hits = run([msg('t1', 'needle'), msg('t2', 'needle'), msg('t3', 'needle')], { regex: /needle/gi });
		assert.equal(hits.size, 3);
	});

	it('searches only the requested fields', () =>
	{
		assert.equal(run([msg('t1', 'x', 'a@x.com', 'needle')], { fields: ['body'] }).size, 0);
		assert.equal(run([msg('t1', 'x', 'a@x.com', 'needle')], { fields: ['subject'] }).size, 1);
		assert.equal(run([msg('t1', 'x', 'needle@x.com')], { fields: ['from'] }).size, 1);
	});

	it('returns a sample only when asked, and strips markup from it', () =>
	{
		assert.equal(run([msg('t1', 'a needle b')]).get('t1').sample, undefined);

		const sample = run([msg('t1', '<p>before <b>needle</b> after</p>')], { sampleLength: 40 }).get('t1').sample;
		assert.match(sample, /needle/);
		assert.ok(!/[<>]/.test(sample), `markup leaked into sample: ${sample}`);
	});

	it('keeps the first sample for a thread', () =>
	{
		const hits = run([msg('t1', 'first needle'), msg('t1', 'second needle')], { sampleLength: 20 });
		assert.match(hits.get('t1').sample, /first/);
	});

	it('skips messages with no text at all', () =>
	{
		assert.equal(run([{ threadId: 't1' }]).size, 0);
	});
});

describe('accumulateHits sender filter', () =>
{
	const sender = /@forge\.example$/i;

	it('only considers messages from a matching sender', () =>
	{
		const hits = run([msg('t1', 'needle', 'bot@forge.example'), msg('t2', 'needle', 'human@other.com')], { senderRegex: sender });
		assert.deepEqual([...hits.keys()], ['t1']);
	});

	it('needs ONE message to satisfy both sender and body', () =>
	{
		// Regression guard: the bot wrote one message and a human wrote the one
		// containing the needle. Filtering the two separately would match this thread.
		const hits = run([msg('t1', 'nothing here', 'bot@forge.example'), msg('t1', 'needle', 'human@other.com')], { senderRegex: sender });
		assert.equal(hits.size, 0);
	});

	it('counts only the sender\'s own matches within a mixed thread', () =>
	{
		const hits = run([msg('t1', 'needle', 'bot@forge.example'), msg('t1', 'needle needle', 'human@other.com')], { senderRegex: sender });
		assert.equal(hits.get('t1').matches, 1);
	});

	it('is not made stateful by a global sender regex', () =>
	{
		const hits = run([msg('a', 'needle', 'x@forge.example'), msg('b', 'needle', 'y@forge.example'), msg('c', 'needle', 'z@forge.example')], { senderRegex: /@forge\.example$/gi });
		assert.equal(hits.size, 3);
	});

	it('applies no filtering when no sender is given', () =>
	{
		assert.equal(run([msg('t1', 'needle', 'a@x.com'), msg('t2', 'needle', 'b@y.com')]).size, 2);
	});
});

describe('senderMatches', () =>
{
	const m = { from: [{ name: 'Forge Bot', email: 'bot@forge.example' }] };

	it('matches an anchored bare address', () =>
	{
		assert.equal(senderMatches(m, /^bot@forge\.example$/i), true);
	});

	it('matches the display name', () => assert.equal(senderMatches(m, /forge bot/i), true));
	it('matches a domain suffix anchored at the end', () => assert.equal(senderMatches(m, /@forge\.example$/i), true));
	it('rejects a different address', () => assert.equal(senderMatches(m, /^other@forge\.example$/i), false));
	it('rejects a message with no sender', () => assert.equal(senderMatches({}, /./), false));

	it('matches when any of several contacts does', () =>
	{
		const multi = { from: [{ email: 'a@x.com' }, { email: 'bot@forge.example' }] };
		assert.equal(senderMatches(multi, /^bot@/), true);
	});
});

describe('fromText', () =>
{
	it('renders name and address', () =>
	{
		assert.equal(fromText({ from: [{ name: 'Bot', email: 'bot@x.com' }] }), 'Bot <bot@x.com>');
	});
	it('tolerates a missing from', () => assert.equal(fromText({}), ''));
});

describe('chunk', () =>
{
	it('splits into fixed-size pieces with a short tail', () =>
	{
		assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
	});
	it('returns nothing for nothing', () => assert.deepEqual(chunk([], 3), []));
	it('keeps everything in one piece when the size exceeds the input', () =>
	{
		assert.deepEqual(chunk([1, 2], 10), [[1, 2]]);
	});
});
