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

export interface MutationResult
{
	requested: number;
	matched: number;
	archived?: number;
	trashed?: number;
	movedToInbox?: number;
	tasksQueued: number;
	missing: string[];
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
export async function applyThreadTasks(deps: MutationDeps, threadIds: string[], kind: MutationKind): Promise<MutationResult>
{
	const requested = Array.from(new Set(threadIds));
	const countKey = kind === 'archive' ? 'archived' : kind === 'trash' ? 'trashed' : 'movedToInbox';

	const threads = await deps.DatabaseStore
		.findAll(deps.Thread)
		.where([deps.Thread.attributes.id.in(requested)]);

	if (!threads.length)
	{
		return { requested: requested.length, matched: 0, [countKey]: 0, tasksQueued: 0, missing: requested };
	}

	let tasks: unknown[];
	if (kind === 'archive') tasks = deps.TaskFactory.tasksForArchiving({ threads, source: SOURCE });
	else if (kind === 'trash') tasks = deps.TaskFactory.tasksForMovingToTrash({ threads, source: SOURCE });
	else tasks = tasksForMovingToInbox(deps, threads, SOURCE);

	// TaskFactory returns null for accounts with no archive/trash category.
	const queued = tasks.filter(task => !!task);
	queued.forEach(task => deps.Actions.queueTask(task));

	const found = new Set(threads.map(thread => thread.id));

	return {
		requested: requested.length,
		matched: threads.length,
		[countKey]: threads.length,
		tasksQueued: queued.length,
		missing: requested.filter(id => !found.has(id)),
	};
}
