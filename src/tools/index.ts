import { ToolServer } from '../types';

import { registerBatchReadEmailsTool } from './registerBatchReadEmailsTool';
import { registerArchiveThreadsTool, registerTrashThreadsTool, registerUnarchiveThreadsTool } from './registerMutateThreadsTools';
import { registerCountThreadsTool, registerGrepThreadsTool, registerSyncStatusTool } from './registerTriageTools';
import { registerEmailStatsTool } from './registerEmailStatsTool';
import { registerGetRecentEmailsTool } from './registerGetRecentEmailsTool';
import { registerListContactsTool } from './registerListContactsTool';
import { registerListDraftsTool } from './registerListDraftsTool';
import { registerListFoldersTool } from './registerListFoldersTool';
import { registerListLabelsTool } from './registerListLabelsTool';
import { registerListThreadsTool } from './registerListThreadsTool';
import { registerReadEmailTool } from './registerReadEmailTool';
import { registerReadThreadTool } from './registerReadThreadTool';
import { registerSearchEmailsTool } from './registerSearchEmailsTool';

export function registerTools(server: ToolServer): void
{
	registerSearchEmailsTool(server);
	registerReadEmailTool(server);
	registerListThreadsTool(server);
	registerReadThreadTool(server);
	registerListContactsTool(server);
	registerListFoldersTool(server);
	registerListLabelsTool(server);
	registerGetRecentEmailsTool(server);
	registerListDraftsTool(server);
	registerEmailStatsTool(server);
	registerBatchReadEmailsTool(server);
	registerArchiveThreadsTool(server);
	registerTrashThreadsTool(server);
	registerUnarchiveThreadsTool(server);
	registerCountThreadsTool(server);
	registerGrepThreadsTool(server);
	registerSyncStatusTool(server);
}