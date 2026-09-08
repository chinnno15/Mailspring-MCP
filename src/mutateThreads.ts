import { MailspringThread } from 'mailspring-exports';
import { z } from 'zod';

export type MutationKind = 'archive' | 'trash' | 'inbox';

export const MAX_BATCH = 200;

// Kept here, beside the logic it guards, so it is testable without the Mailspring runtime.
export const threadIdsInputSchema = {
	threadIds: z.array(z.string()).min(1).max(MAX_BATCH).describe(`Thread IDs to act on (max ${MAX_BATCH} per call)`),
};

// The pieces of mailspring-exports these mutations need. Injected rather than
// imported directly so the logic can be exercised without the Mailspring runtime.
export interface MutationDeps
{
	DatabaseStore: { findAll(model: unknown): { where(matchers: unknown[]): Promise<MailspringThread[]> } };
	TaskFactory: {
		tasksForArchiving(opts: { threads: MailspringThread[]; source: string }): unknown[];
		tasksForMovingToTrash(opts: { threads: MailspringThread[]; source: string }): unknown[];
		tasksForThreadsByAccountId(
			threads: MailspringThread[],
			callback: (accountThreads: MailspringThread[], accountId: string) => unknown,
		): unknown[];
	};
	Actions: { queueTask(task: unknown): void };
	Thread: { attributes: { id: { in(ids: string[]): unknown } } };
	CategoryStore: {
		getInboxCategory(accountId: string): unknown;
		getAllMailCategory(accountId: string): unknown;
	};
	Label: Function;
	ChangeFolderTask: new (opts: { folder: unknown; threads: MailspringThread[]; source: string }) => unknown;
	ChangeLabelsTask: new (opts: { labelsToAdd: unknown[]; labelsToRemove: unknown[]; threads: MailspringThread[]; source: string }) => unknown;
}

export interface PreviewRow
{
	id: string;
	accountId: string;
	subject: string;
	covered: boolean;
}

export interface MutationResult
{
	requested: number;
	matched: number;
	archived?: number;
	trashed?: number;
	movedToInbox?: number;
	tasksQueued: number;
	missing: string[];
	/** Matched threads that no task covers — they will not move. See coveredThreadIds. */
	unaffected?: string[];
	unaffectedAccounts?: string[];
	dryRun?: true;
	preview?: PreviewRow[];
}

export interface MutationOptions
{
	dryRun?: boolean;
	previewLimit?: number;
}

export const DEFAULT_PREVIEW_LIMIT = 50;

/**
 * Thread ids that the built tasks actually act on.
 *
 * TaskFactory returns null for an account with no suitable category, and those
 * nulls are dropped before queueing — so a batch spanning several accounts could
 * report success while silently leaving one account's threads untouched. Reading
 * coverage back off the tasks catches that and any other gap, rather than
 * special-casing the one cause.
 */
export function coveredThreadIds(tasks: unknown[]): Set<string>
{
	const covered = new Set<string>();

	tasks.forEach((task) =>
	{
		const t = task as { threadIds?: string[]; threads?: { id?: string }[] } | null;
		if (!t) return;

		// ChangeMailTask's constructor consumes `threads` and keeps only
		// `threadIds`, so that is the property to read on a real task. `threads`
		// is accepted too for task types that retain it.
		(t.threadIds || []).forEach(id => { if (id) covered.add(id); });
		(t.threads || []).forEach(thread => { if (thread && thread.id) covered.add(thread.id); });
	});

	return covered;
}

export const SOURCE = 'mailspring-mcp';

const DISPLACED_ROLES = ['trash', 'spam'];

/** A thread parked in Trash or Spam has to leave that folder before an INBOX label means anything. */
function isDisplaced(thread: MailspringThread): boolean
{
	const folders = (thread as unknown as { folders?: { role?: string }[] }).folders || [];
	return folders.some(folder => DISPLACED_ROLES.includes(folder.role || ''));
}

/**
 * Tasks that put threads back in the inbox.
 *
 * TaskFactory has no helper for this, so it mirrors what Mailspring's own
 * drag-into-inbox path does: where the inbox is a label (Gmail), re-adding the
 * label is enough for an archived thread, but one sitting in Trash or Spam must
 * first be moved back to All Mail. Where the inbox is a real folder (plain
 * IMAP), a folder move is the whole job.
 */
export function tasksForMovingToInbox(deps: MutationDeps, threads: MailspringThread[], source: string): unknown[]
{
	return deps.TaskFactory.tasksForThreadsByAccountId(threads, (accountThreads, accountId) =>
	{
		const inbox = deps.CategoryStore.getInboxCategory(accountId);
		if (!inbox) return null;

		if (!(inbox instanceof deps.Label))
		{
			return new deps.ChangeFolderTask({ folder: inbox, threads: accountThreads, source });
		}

		const tasks: unknown[] = [];
		const displaced = accountThreads.filter(isDisplaced);
		const allMail = deps.CategoryStore.getAllMailCategory(accountId);

		if (displaced.length && allMail)
		{
			tasks.push(new deps.ChangeFolderTask({ folder: allMail, threads: displaced, source }));
		}

		tasks.push(new deps.ChangeLabelsTask({ labelsToAdd: [inbox], labelsToRemove: [], threads: accountThreads, source }));
		return tasks;
	});
}

/**
 * Archive or trash threads by id.
 *
 * Both routes go through Mailspring's own TaskFactory + task queue, so they sync
 * back to the provider exactly as the UI's buttons do and stay undoable.
 * TaskFactory groups threads by account and picks the right shape per account —
 * archiving a Gmail account removes the INBOX label rather than moving folders.
 */
export async function applyThreadTasks(
	deps: MutationDeps,
	threadIds: string[],
	kind: MutationKind,
	options: MutationOptions = {},
): Promise<MutationResult>
{
	const requested = Array.from(new Set(threadIds));
	const countKey = kind === 'archive' ? 'archived' : kind === 'trash' ? 'trashed' : 'movedToInbox';

	const threads = await deps.DatabaseStore
		.findAll(deps.Thread)
		.where([deps.Thread.attributes.id.in(requested)]);

	if (!threads.length)
	{
		const empty: MutationResult = { requested: requested.length, matched: 0, [countKey]: 0, tasksQueued: 0, missing: requested };
		if (options.dryRun) { empty.dryRun = true; empty.preview = []; }
		return empty;
	}

	let tasks: unknown[];
	if (kind === 'archive') tasks = deps.TaskFactory.tasksForArchiving({ threads, source: SOURCE });
	else if (kind === 'trash') tasks = deps.TaskFactory.tasksForMovingToTrash({ threads, source: SOURCE });
	else tasks = tasksForMovingToInbox(deps, threads, SOURCE);

	// TaskFactory returns null for accounts with no archive/trash category.
	const queued = tasks.filter(task => !!task);

	const covered = coveredThreadIds(queued);
	const unaffected = threads.filter(thread => !covered.has(thread.id));
	const found = new Set(threads.map(thread => thread.id));

	// Only threads a task actually covers will move.
	const willMove = threads.length - unaffected.length;

	const result: MutationResult = {
		requested: requested.length,
		matched: threads.length,
		[countKey]: willMove,
		tasksQueued: queued.length,
		missing: requested.filter(id => !found.has(id)),
	};

	if (unaffected.length)
	{
		result.unaffected = unaffected.map(thread => thread.id);
		result.unaffectedAccounts = Array.from(new Set(unaffected.map(t => (t as unknown as { accountId: string }).accountId)));
	}

	if (options.dryRun)
	{
		result.dryRun = true;
		result.preview = threads
			.slice(0, options.previewLimit ?? DEFAULT_PREVIEW_LIMIT)
			.map(thread => ({
				id: thread.id,
				accountId: (thread as unknown as { accountId: string }).accountId,
				subject: thread.subject || '',
				covered: covered.has(thread.id),
			}));
		return result;
	}

	queued.forEach(task => deps.Actions.queueTask(task));

	return result;
}
