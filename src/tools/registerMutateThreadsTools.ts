import { Actions, DatabaseStore, TaskFactory, Thread } from 'mailspring-exports';
import { json } from '../helpers';
import { MAX_BATCH, MutationKind, MutationDeps, applyThreadTasks, threadIdsInputSchema } from '../mutateThreads';
import { ToolServer } from '../types';

interface ThreadIdsParams
{
	threadIds: string[];
}

const deps = { DatabaseStore, TaskFactory, Actions, Thread } as unknown as MutationDeps;

async function run(params: ThreadIdsParams, kind: MutationKind)
{
	return json(await applyThreadTasks(deps, params.threadIds, kind));
}

export function registerArchiveThreadsTool(server: ToolServer): void
{
	server.registerTool(
		'archive_threads',
		{
			description: `Archive threads by ID (removes them from the inbox; on Gmail accounts this removes the INBOX label). Reversible. Accepts up to ${MAX_BATCH} thread IDs per call.`,
			inputSchema: threadIdsInputSchema,
		},
		(params: ThreadIdsParams) => run(params, 'archive')
	);
}

export function registerTrashThreadsTool(server: ToolServer): void
{
	server.registerTool(
		'trash_threads',
		{
			description: `Move threads to Trash by ID. Recoverable from Trash until the provider purges it (30 days on Gmail). Accepts up to ${MAX_BATCH} thread IDs per call.`,
			inputSchema: threadIdsInputSchema,
		},
		(params: ThreadIdsParams) => run(params, 'trash')
	);
}
