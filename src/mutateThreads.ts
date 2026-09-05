import { MailspringThread } from 'mailspring-exports';
import { z } from 'zod';

export type MutationKind = 'archive' | 'trash';

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
	};
	Actions: { queueTask(task: unknown): void };
	Thread: { attributes: { id: { in(ids: string[]): unknown } } };
}

export interface MutationResult
{
	requested: number;
	matched: number;
	archived?: number;
	trashed?: number;
	tasksQueued: number;
	missing: string[];
}

export const SOURCE = 'mailspring-mcp';

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
	const countKey = kind === 'archive' ? 'archived' : 'trashed';

	const threads = await deps.DatabaseStore
		.findAll(deps.Thread)
		.where([deps.Thread.attributes.id.in(requested)]);

	if (!threads.length)
	{
		return { requested: requested.length, matched: 0, [countKey]: 0, tasksQueued: 0, missing: requested };
	}

	const tasks = kind === 'archive'
		? deps.TaskFactory.tasksForArchiving({ threads, source: SOURCE })
		: deps.TaskFactory.tasksForMovingToTrash({ threads, source: SOURCE });

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
