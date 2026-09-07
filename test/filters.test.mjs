import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NoMatchingCategoryError, selectCategoryIds } from '../lib/filters.js';

// One INBOX per account — the shape that broke the previous implementation.
const CATS = [
	{ id: 'inbox-a', path: 'INBOX' },
	{ id: 'inbox-b', path: 'INBOX' },
	{ id: 'inbox-c', path: 'INBOX' },
	{ id: 'inbox-d', path: 'INBOX' },
	{ id: 'all-a', path: '[Gmail]/All Mail' },
	{ id: 'trash-a', path: '[Gmail]/Trash' },
	{ id: 'trash-d', path: '[Gmail]/Papelera' },
];

describe('selectCategoryIds', () =>
{
	it('returns every account\'s INBOX, not just the first', () =>
	{
		// Regression: find() returned one id, so a 4-account mailbox reported
		// only one account's threads.
		assert.deepEqual(selectCategoryIds(CATS, 'INBOX', 'folder'), ['inbox-a', 'inbox-b', 'inbox-c', 'inbox-d']);
	});

	it('throws on a name that matches nothing', () =>
	{
		// Regression: returning [] meant no matcher was added and the query
		// silently widened to the entire mailbox.
		assert.throws(() => selectCategoryIds(CATS, 'zzz-not-real', 'folder'), NoMatchingCategoryError);
	});

	it('names the offending value and kind in the error', () =>
	{
		try { selectCategoryIds(CATS, 'nope', 'label'); assert.fail('should have thrown'); }
		catch (err)
		{
			assert.match(err.message, /No label matches "nope"/);
			assert.match(err.message, /list_folders or list_labels/);
		}
	});

	it('throws rather than returning an empty list, so callers cannot ignore it', () =>
	{
		let returned = 'did not return';
		try { returned = selectCategoryIds([], 'INBOX', 'folder'); } catch { returned = 'threw'; }
		assert.equal(returned, 'threw');
	});

	it('matches case-insensitively', () =>
	{
		assert.deepEqual(selectCategoryIds(CATS, 'inbox', 'folder').length, 4);
	});

	it('matches on a substring', () =>
	{
		assert.deepEqual(selectCategoryIds(CATS, 'Trash', 'folder'), ['trash-a']);
	});

	it('searches folders and labels together', () =>
	{
		const mixed = [{ id: 'f1', path: 'Archive' }, { id: 'l1', path: 'Archived' }];
		assert.deepEqual(selectCategoryIds(mixed, 'archive', 'folder'), ['f1', 'l1']);
	});

	it('tolerates a category with no path', () =>
	{
		const withNull = [{ id: 'x' }, { id: 'y', path: 'INBOX' }];
		assert.deepEqual(selectCategoryIds(withNull, 'INBOX', 'folder'), ['y']);
	});

	it('does not match a localized trash path under the English name', () =>
	{
		assert.throws(() => selectCategoryIds([{ id: 'd', path: '[Gmail]/Papelera' }], 'Trash', 'folder'));
	});
});
