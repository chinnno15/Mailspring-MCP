import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyThreadTasks, coveredThreadIds } from '../lib/mutateThreads.js';
import { makeDeps, threadsFixture } from './helpers.mjs';

describe('coveredThreadIds', () =>
{
	it('reads threadIds, which is what a real ChangeMailTask exposes', () =>
	{
		// Regression: reading only `threads` found nothing on real tasks, so every
		// thread was reported unaffected and the moved count came back 0.
		const tasks = [{ threadIds: ['a', 'b'] }, { threadIds: ['c'] }];
		assert.deepEqual([...coveredThreadIds(tasks)].sort(), ['a', 'b', 'c']);
	});

	it('also accepts a task that retains threads objects', () =>
	{
		assert.deepEqual([...coveredThreadIds([{ threads: [{ id: 'z' }] }])], ['z']);
	});

	it('ignores nulls and tasks with no threads', () =>
	{
		assert.deepEqual([...coveredThreadIds([null, {}, { threadIds: [] }, { threadIds: ['x'] }])], ['x']);
	});

	it('returns empty for no tasks', () => assert.equal(coveredThreadIds([]).size, 0));
});

describe('dryRun', () =>
{
	it('queues nothing', async () =>
	{
		const { deps, calls } = makeDeps({ threads: threadsFixture('a', 'b') });
		await applyThreadTasks(deps, ['a', 'b'], 'trash', { dryRun: true });

		assert.equal(calls.queued.length, 0, 'dryRun must not queue');
	});

	it('still reports the counts a real run would', async () =>
	{
		const { deps } = makeDeps({ threads: threadsFixture('a', 'b'), tasks: [{ threadIds: ['a', 'b'] }] });
		const res = await applyThreadTasks(deps, ['a', 'b'], 'trash', { dryRun: true });

		assert.equal(res.dryRun, true);
		assert.equal(res.matched, 2);
		assert.equal(res.trashed, 2);
		assert.equal(res.tasksQueued, 1);
	});

	it('previews each thread with its coverage', async () =>
	{
		const { deps } = makeDeps({ threads: threadsFixture('a', 'b'), tasks: [{ threadIds: ['a'] }] });
		const res = await applyThreadTasks(deps, ['a', 'b'], 'archive', { dryRun: true });

		assert.deepEqual(res.preview.map(p => [p.id, p.covered]), [['a', true], ['b', false]]);
		assert.ok(res.preview.every(p => 'subject' in p && 'accountId' in p));
	});

	it('honours previewLimit without changing the counts', async () =>
	{
		const ids = Array.from({ length: 30 }, (_, i) => `t${i}`);
		const { deps } = makeDeps({ threads: threadsFixture(...ids) });
		const res = await applyThreadTasks(deps, ids, 'trash', { dryRun: true, previewLimit: 5 });

		assert.equal(res.preview.length, 5);
		assert.equal(res.matched, 30);
	});

	it('reports missing ids and an empty preview when nothing matches', async () =>
	{
		const { deps } = makeDeps({ threads: [] });
		const res = await applyThreadTasks(deps, ['ghost'], 'trash', { dryRun: true });

		assert.equal(res.dryRun, true);
		assert.deepEqual(res.preview, []);
		assert.deepEqual(res.missing, ['ghost']);
	});

	it('a real run queues, a dry run does not, from identical input', async () =>
	{
		const wet = makeDeps({ threads: threadsFixture('a') });
		const dry = makeDeps({ threads: threadsFixture('a') });

		await applyThreadTasks(wet.deps, ['a'], 'trash');
		await applyThreadTasks(dry.deps, ['a'], 'trash', { dryRun: true });

		assert.equal(wet.calls.queued.length, 1);
		assert.equal(dry.calls.queued.length, 0);
	});
});

describe('unaffected threads (silent per-account failure)', () =>
{
	it('reports threads no task covers', async () =>
	{
		// One account's task came back null, so its threads will not move.
		const { deps } = makeDeps({ threads: threadsFixture('a', 'b'), tasks: [{ threadIds: ['a'] }] });
		const res = await applyThreadTasks(deps, ['a', 'b'], 'trash');

		assert.deepEqual(res.unaffected, ['b']);
		assert.equal(res.trashed, 1, 'the count must reflect what will actually move, not what matched');
		assert.equal(res.matched, 2);
	});

	it('names the accounts left behind', async () =>
	{
		const threads = [
			{ id: 'a', accountId: 'acct1', subject: 's', folders: [{ role: 'all' }] },
			{ id: 'b', accountId: 'acct2', subject: 's', folders: [{ role: 'all' }] },
		];
		const { deps } = makeDeps({ threads, tasks: [{ threadIds: ['a'] }] });
		const res = await applyThreadTasks(deps, ['a', 'b'], 'archive');

		assert.deepEqual(res.unaffectedAccounts, ['acct2']);
	});

	it('omits the field entirely when everything is covered', async () =>
	{
		const { deps } = makeDeps({ threads: threadsFixture('a'), tasks: [{ threadIds: ['a'] }] });
		const res = await applyThreadTasks(deps, ['a'], 'trash');

		assert.ok(!('unaffected' in res));
		assert.equal(res.trashed, 1);
	});

	it('reports zero moved when every task was dropped', async () =>
	{
		const { deps, calls } = makeDeps({ threads: threadsFixture('a', 'b'), tasks: [null, null] });
		const res = await applyThreadTasks(deps, ['a', 'b'], 'trash');

		assert.equal(res.trashed, 0, 'must not claim success when nothing was queued');
		assert.equal(res.tasksQueued, 0);
		assert.deepEqual(res.unaffected.sort(), ['a', 'b']);
		assert.equal(calls.queued.length, 0);
	});
});
