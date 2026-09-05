// Minimal fakes standing in for the slice of mailspring-exports the mutations use.
export function makeDeps({ threads = [], tasks = null, throwOnQueue = false } = {})
{
	const calls = { where: [], archiving: 0, trashing: 0, queued: [], sources: [] };

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

	const TaskFactory = {
		tasksForArchiving: (opts) => { calls.archiving += 1; calls.sources.push(opts.source);
			return tasks !== null ? tasks : [{ kind: 'archive', count: opts.threads.length }]; },
		tasksForMovingToTrash: (opts) => { calls.trashing += 1; calls.sources.push(opts.source);
			return tasks !== null ? tasks : [{ kind: 'trash', count: opts.threads.length }]; },
	};

	const Actions = {
		queueTask(task)
		{
			if (throwOnQueue) throw new Error('queue exploded');
			calls.queued.push(task);
		},
	};

	return { deps: { DatabaseStore, TaskFactory, Actions, Thread }, calls };
}

export const threadsFixture = (...ids) => ids.map(id => ({ id, subject: `subject ${id}` }));
