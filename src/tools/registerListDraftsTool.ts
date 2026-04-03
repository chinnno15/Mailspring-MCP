import { DatabaseStore, Message } from 'mailspring-exports';
import { z } from 'zod';

import { formatMessage, json } from '../helpers';
import { ListDraftsParams, ToolServer } from '../types';

const listDraftsDescription = 'List draft emails with pagination.';

const listDraftsInputSchema = {
	limit: z.number().default(50).describe('Max number of results to return'),
	offset: z.number().default(0).describe('Offset for pagination'),
};

async function handleListDrafts({ limit, offset }: ListDraftsParams)
{
	const drafts = await DatabaseStore.findAll(Message)
		.where([Message.attributes.draft.equal(true)])
		.order(Message.attributes.date.descending())
		.limit(limit)
		.offset(offset);

	return json(drafts.map(formatMessage));
}

export function registerListDraftsTool(server: ToolServer): void
{
	server.registerTool('list_drafts', { description: listDraftsDescription, inputSchema: listDraftsInputSchema }, handleListDrafts);
}