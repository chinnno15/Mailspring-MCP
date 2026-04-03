import { Contact, DatabaseStore } from 'mailspring-exports';
import { z } from 'zod';

import { json } from '../helpers';
import { ListContactsParams, ToolServer } from '../types';

const listContactsDescription = 'List or search contacts from the address book.';

const listContactsInputSchema = {
	search: z.string().optional().describe('Search by name or email'),
	limit: z.number().default(50).describe('Max number of contacts to pull'),
	offset: z.number().default(0).describe('Offset for pagination'),
};
async function handleListContacts({ search, limit, offset }: ListContactsParams)
{
	const contacts = await DatabaseStore.findAll(Contact).limit(2000);
	let filtered = contacts.filter(contact => !contact.hidden);
	if (search)
	{
		const query = search.toLowerCase();
		filtered = filtered.filter(contact =>
			contact.email?.toLowerCase().includes(query) ||
			contact.name?.toLowerCase().includes(query)
		);
	}

	return json(filtered.slice(offset, offset + limit).map(contact => ({
		id: contact.id,
		email: contact.email,
		name: contact.name || '',
		refs: contact.refs,
	})));
}

export function registerListContactsTool(server: ToolServer): void
{
	server.registerTool('list_contacts', { description: listContactsDescription, inputSchema: listContactsInputSchema }, handleListContacts);
}