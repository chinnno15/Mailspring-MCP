import { DatabaseStore, Folder } from 'mailspring-exports';

import { json } from '../helpers';
import { ToolServer } from '../types';

const listFoldersDescription = 'List all email folders/mailboxes.';

async function handleListFolders()
{
	const folders = await DatabaseStore.findAll(Folder);
	return json(folders.map(folder => ({
		id: folder.id,
		path: folder.path,
		role: folder.role,
		accountId: folder.accountId,
	})));
}

export function registerListFoldersTool(server: ToolServer): void
{
	server.registerTool('list_folders', { description: listFoldersDescription }, handleListFolders);
}