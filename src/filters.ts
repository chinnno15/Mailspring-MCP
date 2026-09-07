export interface CategoryRow
{
	id: string;
	path?: string;
}

export class NoMatchingCategoryError extends Error
{
	constructor(kind: string, value: string)
	{
		super(
			`No ${kind} matches "${value}". Refusing to run an unfiltered query — ` +
			'call list_folders or list_labels to see the available paths.'
		);
		this.name = 'NoMatchingCategoryError';
	}
}

/**
 * Every category id whose path contains `value`, matched across folders and
 * labels and across all accounts.
 *
 * Two failures are being guarded against here. Taking only the first match
 * (find()) hides every other account's threads on a multi-account mailbox —
 * "INBOX" is a distinct category per account. And returning nothing for an
 * unmatched name is worse than useless: the caller adds no matcher, the query
 * degrades to "every thread", and a filter meant to select the inbox instead
 * selects the whole mailbox. That is a live hazard once thread ids feed
 * archive/trash, so an unmatched name throws.
 */
export function selectCategoryIds(categories: CategoryRow[], value: string, kind: string): string[]
{
	const needle = value.toLowerCase();
	const ids = categories
		.filter(category => (category.path || '').toLowerCase().includes(needle))
		.map(category => category.id);

	if (!ids.length) throw new NoMatchingCategoryError(kind, value);

	return ids;
}
