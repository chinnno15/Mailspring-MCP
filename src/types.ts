export interface ThreadFilterParams
{
	folder?: string;
	label?: string;
	unread?: boolean;
	starred?: boolean;
	hasAttachment?: boolean;
	dateFrom?: string;
	dateTo?: string;
}

export interface SearchEmailsParams extends ThreadFilterParams
{
	query?: string;
	from?: string;
	to?: string;
	subject?: string;
	limit: number;
	offset: number;
}

export interface ReadByIdParams
{
	id: string;
}

export interface ListThreadsParams extends ThreadFilterParams
{
	limit: number;
	offset: number;
}

export interface ListContactsParams
{
	search?: string;
	limit: number;
	offset: number;
}

export interface GetRecentEmailsParams
{
	limit: number;
	offset: number;
	dateFrom?: string;
	dateTo?: string;
}

export interface ListDraftsParams
{
	limit: number;
	offset: number;
}

export interface BatchReadEmailsParams
{
	ids: string[];
}

export type ToolServer = any;