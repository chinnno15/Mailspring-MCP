import { DatabaseStore, Label } from 'mailspring-exports';

import { json } from '../helpers';
import { ToolServer } from '../types';

const listLabelsDescription = 'List all email labels (Gmail labels, etc.).';

async function handleListLabels()
{
	const labels = await DatabaseStore.findAll(Label);
	return json(labels.map(label => ({
		id: label.id,
		path: label.path,
		role: label.role,
		accountId: label.accountId,
	})));
}

export function registerListLabelsTool(server: ToolServer): void
{
	server.registerTool('list_labels', { description: listLabelsDescription }, handleListLabels);
}