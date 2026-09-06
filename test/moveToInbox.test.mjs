import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyThreadTasks, tasksForMovingToInbox } from '../lib/mutateThreads.js';
import { FakeFolder, makeDeps, threadsFixture, trashedThread } from './helpers.mjs';

describe('tasksForMovingToInbox', () =>
{
	it('re-adds the INBOX label for an archived Gmail thread', () =>
	{
		const { deps, calls, fixtures } = makeDeps({ threads: threadsFixture('a') });
		const tasks = tasksForMovingToInbox(deps, threadsFixture('a'), 'test');

		assert.equal(tasks.length, 1);
		assert.equal(calls.labelTasks.length, 1);
		assert.equal(calls.folderTasks.length, 0, 'an archived thread needs no folder move');
		assert.deepEqual(calls.labelTasks[0].labelsToAdd, [fixtures.inbox]);
		assert.deepEqual(calls.labelTasks[0].labelsToRemove, []);
	});

	it('moves a trashed thread out of Trash before labelling it', () =>
	{
		const { deps, calls, fixtures } = makeDeps({});
		const tasks = tasksForMovingToInbox(deps, [trashedThread('a')], 'test');

		assert.equal(tasks.length, 2, 'expected a folder move and a label change');
		assert.equal(calls.folderTasks.length, 1);
		assert.equal(calls.folderTasks[0].folder, fixtures.allMail);
		assert.equal(calls.labelTasks.length, 1);
	});

	it('orders the folder move before the label change', () =>
	{
		const { deps } = makeDeps({});
		const tasks = tasksForMovingToInbox(deps, [trashedThread('a')], 'test');
		assert.equal(tasks[0].type, 'folder');
		assert.equal(tasks[1].type, 'labels');
	});

	it('moves only the displaced threads, but labels them all', () =>
	{
		const { deps, calls } = makeDeps({});
		const mixed = [...threadsFixture('archived'), trashedThread('trashed')];
		tasksForMovingToInbox(deps, mixed, 'test');

		assert.deepEqual(calls.folderTasks[0].threads.map(t => t.id), ['trashed']);
		assert.deepEqual(calls.labelTasks[0].threads.map(t => t.id), ['archived', 'trashed']);
	});

	it('uses a plain folder move when the inbox is a folder (non-Gmail IMAP)', () =>
	{
		const { deps, calls, fixtures } = makeDeps({ inboxIsLabel: false });
		const tasks = tasksForMovingToInbox(deps, threadsFixture('a'), 'test');

		assert.equal(tasks.length, 1);
		assert.equal(calls.folderTasks.length, 1);
		assert.equal(calls.folderTasks[0].folder, fixtures.inbox);
		assert.equal(calls.labelTasks.length, 0, 'a folder account must not get label tasks');
	});

	it('skips an account with no inbox category rather than throwing', () =>
	{
		const { deps } = makeDeps({ noInbox: true });
		assert.deepEqual(tasksForMovingToInbox(deps, threadsFixture('a'), 'test'), []);
	});

	it('still labels when All Mail is missing, rather than dropping the restore', () =>
	{
		const { deps, calls } = makeDeps({ noAllMail: true });
		const tasks = tasksForMovingToInbox(deps, [trashedThread('a')], 'test');

		assert.equal(tasks.length, 1);
		assert.equal(calls.folderTasks.length, 0);
		assert.equal(calls.labelTasks.length, 1);
	});

	it('groups per account, so a multi-account batch gets its own tasks each', () =>
	{
		const { deps, calls } = makeDeps({});
		tasksForMovingToInbox(deps, [trashedThread('a', 'acct1'), trashedThread('b', 'acct2')], 'test');

		assert.equal(calls.folderTasks.length, 2);
		assert.equal(calls.labelTasks.length, 2);
	});
});

describe('applyThreadTasks(kind: inbox)', () =>
{
	it('reports movedToInbox and queues the tasks', async () =>
	{
		const { deps, calls } = makeDeps({ threads: threadsFixture('a') });
		const res = await applyThreadTasks(deps, ['a'], 'inbox');

		assert.equal(res.movedToInbox, 1);
		assert.equal(res.matched, 1);
		assert.ok(res.tasksQueued >= 1);
		assert.equal(calls.queued.length, res.tasksQueued);
	});

	it('does not report archived or trashed for an inbox move', async () =>
	{
		const { deps } = makeDeps({ threads: threadsFixture('a') });
		const res = await applyThreadTasks(deps, ['a'], 'inbox');

		assert.ok(!('archived' in res));
		assert.ok(!('trashed' in res));
	});

	it('queues nothing and reports missing for unknown ids', async () =>
	{
		const { deps, calls } = makeDeps({ threads: [] });
		const res = await applyThreadTasks(deps, ['ghost'], 'inbox');

		assert.deepEqual(res, { requested: 1, matched: 0, movedToInbox: 0, tasksQueued: 0, missing: ['ghost'] });
		assert.equal(calls.queued.length, 0);
	});
});
