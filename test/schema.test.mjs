import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { MAX_BATCH, threadIdsInputSchema } from '../lib/mutateThreads.js';

const schema = z.object(threadIdsInputSchema);

describe('threadIds input schema', () =>
{
	it('accepts a single id', () =>
	{
		assert.deepEqual(schema.parse({ threadIds: ['a'] }), { threadIds: ['a'] });
	});

	it('accepts exactly MAX_BATCH ids', () =>
	{
		const ids = Array.from({ length: MAX_BATCH }, (_, i) => `t${i}`);
		assert.equal(schema.parse({ threadIds: ids }).threadIds.length, MAX_BATCH);
	});

	it('rejects an empty array', () =>
	{
		assert.throws(() => schema.parse({ threadIds: [] }));
	});

	it('rejects more than MAX_BATCH ids, so a huge call cannot silently truncate', () =>
	{
		const ids = Array.from({ length: MAX_BATCH + 1 }, (_, i) => `t${i}`);
		assert.throws(() => schema.parse({ threadIds: ids }));
	});

	it('rejects non-string ids', () =>
	{
		assert.throws(() => schema.parse({ threadIds: [123] }));
	});

	it('requires the threadIds field', () =>
	{
		assert.throws(() => schema.parse({}));
	});
});
