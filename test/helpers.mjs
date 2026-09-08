// Minimal fakes standing in for the slice of mailspring-exports the mutations use.
export class FakeLabel { constructor(path, role) { this.path = path; this.role = role; } }
export class FakeFolder { constructor(path, role) { this.path = path; this.role = role; } }

export function makeDeps({ threads = [], tasks = null, throwOnQueue = false, inboxIsLabel = true, noInbox = false, noAllMail = false } = {})
{
	const calls = { where: [], archiving: 0, trashing: 0, queued: [], sources: [], folderTasks: [], labelTasks: [] };

	const Thread = { attributes: { id: { in: (ids) => ({ op: 'in', ids }) } } };

	const DatabaseStore = {
		findAll(model)
		{
			if (model !== Thread) throw new Error('findAll called with unexpected model');
			return {
				where(matchers)
				{
					calls.where.push(matchers);
					const ids = new Set(matchers[0].ids);
					return Promise.resolve(threads.filter(t => ids.has(t.id)));
				},
			};
		},
	};

	const build = (kind) => ({ threads: got, source }) => {
		calls[kind] += 1;
		calls.sources.push(source);
		return tasks !== null ? tasks : [{ kind, count: got.length }];
	};

	// A real ChangeMailTask consumes `threads` in its constructor and exposes
	// only `threadIds`. The fake mirrors that exactly — carrying `threads`
	// instead made coverage reporting look correct in tests while failing
	// against the live app.
	const TaskFactory = {
		tasksForArchiving: (opts) => { calls.archiving += 1; calls.sources.push(opts.source);
			return tasks !== null ? tasks : [{ kind: 'archive', threadIds: opts.threads.map(t => t.id) }]; },
		tasksForMovingToTrash: (opts) => { calls.trashing += 1; calls.sources.push(opts.source);
			return tasks !== null ? tasks : [{ kind: 'trash', threadIds: opts.threads.map(t => t.id) }]; },
	};

	const Actions = {
		queueTask(task)
		{
			if (throwOnQueue) throw new Error('queue exploded');
			calls.queued.push(task);
		},
	};

	// Grouping mirrors the real TaskFactory: arrays from the callback are flattened,
	// null/undefined are dropped.
	TaskFactory.tasksForThreadsByAccountId = (given, cb) =>
	{
		const byAccount = new Map();
		given.forEach((t) => {
			const id = t.accountId ?? 'acct1';
			if (!byAccount.has(id)) byAccount.set(id, []);
			byAccount.get(id).push(t);
		});
		const out = [];
		for (const [id, accountThreads] of byAccount)
		{
			const r = cb(accountThreads, id);
			if (Array.isArray(r)) out.push(...r);
			else if (r) out.push(r);
		}
		return out;
	};

	const inbox = noInbox ? null : (inboxIsLabel ? new FakeLabel('INBOX', 'inbox') : new FakeFolder('INBOX', 'inbox'));
	const allMail = noAllMail ? null : new FakeFolder('[Gmail]/All Mail', 'all');
	const CategoryStore = {
		getInboxCategory: () => inbox,
		getAllMailCategory: () => allMail,
	};

	// Mirror ChangeMailTask: threads in, threadIds retained.
	class ChangeFolderTask { constructor(o) { Object.assign(this, o); this.threadIds = (o.threads || []).map(t => t.id); this.type = 'folder'; calls.folderTasks.push(this); } }
	class ChangeLabelsTask { constructor(o) { Object.assign(this, o); this.threadIds = (o.threads || []).map(t => t.id); this.type = 'labels'; calls.labelTasks.push(this); } }

	return {
		deps: { DatabaseStore, TaskFactory, Actions, Thread, CategoryStore, Label: FakeLabel, ChangeFolderTask, ChangeLabelsTask },
		calls,
		fixtures: { inbox, allMail },
	};
}

export const threadsFixture = (...ids) => ids.map(id => ({ id, subject: `subject ${id}`, accountId: 'acct1', folders: [{ role: 'all' }] }));

/** A thread sitting in Trash — must be moved out of that folder before a label restores it. */
export const trashedThread = (id, accountId = 'acct1') => ({ id, subject: `subject ${id}`, accountId, folders: [{ role: 'trash' }] });
