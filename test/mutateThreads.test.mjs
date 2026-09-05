import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_BATCH, SOURCE, applyThreadTasks } from '../lib/mutateThreads.js';
import { makeDeps, threadsFixture } from './helpers.mjs';

describe('applyThreadTasks', () =>
{
	it('archives matched threads and queues the tasks', async () =>
	{
		const { deps, calls } = makeDeps({ threads: threadsFixture('a', 'b') });
		const res = await applyThreadTasks(deps, ['a', 'b'], 'archive');

		assert.deepEqual(res, { requested: 2, matched: 2, archived: 2, tasksQueued: 1, missing: [] });
		assert.equal(calls.archiving, 1);
		assert.equal(calls.trashing, 0);
		assert.equal(calls.queued.length, 1);
	});

	it('trashes matched threads and queues the tasks', async () =>
	{
		const { deps, calls } = makeDeps({ threads: threadsFixture('a') });
		const res = await applyThreadTasks(deps, ['a'], 'trash');

		assert.deepEqual(res, { requested: 1, matched: 1, trashed: 1, tasksQueued: 1, missing: [] });
		assert.equal(calls.trashing, 1);
		assert.equal(calls.archiving, 0);
	});

	it('uses the trashed key for trash and archived key for archive', async () =>
	{
		const { deps } = makeDeps({ threads: threadsFixture('a') });
		assert.ok('archived' in await applyThreadTasks(deps, ['a'], 'archive'));
		assert.ok('trashed' in await applyThreadTasks(deps, ['a'], 'trash'));
	});

	it('deduplicates repeated ids before querying', async () =>
	{
		const { deps, calls } = makeDeps({ threads: threadsFixture('a') });
		const res = await applyThreadTasks(deps, ['a', 'a', 'a'], 'trash');

		assert.equal(res.requested, 1);
		assert.deepEqual(calls.where[0][0].ids, ['a']);
	});

	it('reports ids that matched no thread', async () =>
	{
		const { deps } = makeDeps({ threads: threadsFixture('a') });
		const res = await applyThreadTasks(deps, ['a', 'ghost', 'phantom'], 'trash');

		assert.equal(res.matched, 1);
		assert.equal(res.trashed, 1);
		assert.deepEqual(res.missing, ['ghost', 'phantom']);
	});

	it('queues nothing when no thread matches', async () =>
	{
		const { deps, calls } = makeDeps({ threads: [] });
		const res = await applyThreadTasks(deps, ['ghost'], 'archive');

		assert.deepEqual(res, { requested: 1, matched: 0, archived: 0, tasksQueued: 0, missing: ['ghost'] });
		assert.equal(calls.archiving, 0, 'must not build tasks for an empty set');
		assert.equal(calls.queued.length, 0);
	});

	it('queues every task TaskFactory returns (one per account)', async () =>
	{
		const { deps, calls } = makeDeps({
			threads: threadsFixture('a', 'b', 'c'),
			tasks: [{ acct: 1 }, { acct: 2 }, { acct: 3 }],
		});
		const res = await applyThreadTasks(deps, ['a', 'b', 'c'], 'trash');

		assert.equal(res.tasksQueued, 3);
		assert.equal(calls.queued.length, 3);
	});

	it('skips null tasks for accounts with no archive or trash category', async () =>
	{
		const { deps, calls } = makeDeps({
			threads: threadsFixture('a', 'b'),
			tasks: [{ acct: 1 }, null, undefined],
		});
		const res = await applyThreadTasks(deps, ['a', 'b'], 'archive');

		assert.equal(res.tasksQueued, 1, 'null tasks must not be queued or counted');
		assert.equal(calls.queued.length, 1);
		assert.equal(res.matched, 2, 'matched still reflects threads found');
	});

	it('tags tasks with the plugin source so they are attributable', async () =>
	{
		const { deps, calls } = makeDeps({ threads: threadsFixture('a') });
		await applyThreadTasks(deps, ['a'], 'archive');
		assert.deepEqual(calls.sources, [SOURCE]);
	});

	it('queries by id using the in() matcher', async () =>
	{
		const { deps, calls } = makeDeps({ threads: threadsFixture('a') });
		await applyThreadTasks(deps, ['a'], 'trash');
		assert.equal(calls.where[0][0].op, 'in');
	});

	it('handles a full MAX_BATCH without truncating', async () =>
	{
		const ids = Array.from({ length: MAX_BATCH }, (_, i) => `t${i}`);
		const { deps } = makeDeps({ threads: threadsFixture(...ids) });
		const res = await applyThreadTasks(deps, ids, 'trash');

		assert.equal(res.requested, MAX_BATCH);
		assert.equal(res.trashed, MAX_BATCH);
		assert.deepEqual(res.missing, []);
	});

	it('propagates a queue failure rather than reporting success', async () =>
	{
		const { deps } = makeDeps({ threads: threadsFixture('a'), throwOnQueue: true });
		await assert.rejects(() => applyThreadTasks(deps, ['a'], 'trash'), /queue exploded/);
	});
});
