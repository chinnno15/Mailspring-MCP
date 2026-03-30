import http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { DatabaseStore, Thread, Message, Contact, Folder, Label, MailspringThread, MailspringMessage, MailspringContact } from 'mailspring-exports';

const MCP_PORT = 2525;
let httpServer: http.Server | null = null;

export function activate()
{
	startServer();
}

export function serialize() { }

export function deactivate()
{
	if (httpServer)
	{
		httpServer.close();
		httpServer = null;
	}
}

function createMcpServer(): McpServer
{
	const server = new McpServer({ name: "mailspring", version: "1.0.0" });

	// @ts-expect-error TS2589: Zod + MCP SDK deep type instantiation
	server.registerTool(
		"search_emails",
		{
			description: "Search through emails by keyword via full-text search. Returns matching threads.",
			inputSchema: {
				query: z.string().describe("Search query string"),
				limit: z.number().default(25).describe("Max results to return (1-200)"),
			},
		},
		async ({ query, limit }) =>
		{
			const threads = await DatabaseStore.findAll(Thread)
				.search(query)
				.limit(limit);
			return json(threads.map(formatThread));
		}
	);

	server.registerTool(
		"read_email",
		{
			description: "Read a specific email by its ID, including the full body content.",
			inputSchema: { id: z.string().describe("The message ID") },
		},
		async ({ id }) =>
		{
			const message = await DatabaseStore.find(Message, id)
				.include(Message.attributes.body);
			if (!message)
			{
				return text("Message not found.");
			}
			return json({
				...formatMessage(message),
				body: stripHtml(message.body || ""),
			});
		}
	);

	// @ts-expect-error TS2589: Zod + MCP SDK deep type instantiation
	server.registerTool(
		"list_threads",
		{
			description: "List email threads with optional filters for folder, label, unread/starred status.",
			inputSchema: {
				folder: z.string().optional().describe("Filter by folder path (e.g. 'INBOX', 'Sent Mail')"),
				label: z.string().optional().describe("Filter by label path"),
				unread: z.boolean().optional().describe("Filter by unread status"),
				starred: z.boolean().optional().describe("Filter by starred status"),
				limit: z.number().default(25).describe("Max results (1-200)"),
				offset: z.number().default(0).describe("Offset for pagination"),
			},
		},
		async ({ folder, label, unread, starred, limit, offset }) =>
		{
			const matchers = [];

			if (unread !== undefined)
			{
				matchers.push(Thread.attributes.unread.equal(unread));
			}
			if (starred !== undefined)
			{
				matchers.push(Thread.attributes.starred.equal(starred));
			}
			if (folder)
			{
				const folders = await DatabaseStore.findAll(Folder);
				const match = folders.find(f => f.path.toLowerCase().includes(folder.toLowerCase()));
				if (match)
				{
					matchers.push(Thread.attributes.categories.contains(match.id));
				}
			}
			if (label)
			{
				const labels = await DatabaseStore.findAll(Label);
				const match = labels.find(l => l.path.toLowerCase().includes(label.toLowerCase()));
				if (match)
				{
					matchers.push(Thread.attributes.categories.contains(match.id));
				}
			}

			let query = DatabaseStore.findAll(Thread);
			if (matchers.length)
			{
				query = query.where(matchers);
			}
			const threads = await query
				.order(Thread.attributes.lastMessageReceivedTimestamp.descending())
				.limit(limit)
				.offset(offset);

			return json(threads.map(formatThread));
		}
	);

	server.registerTool(
		"read_thread",
		{
			description: "Read a full email thread including all messages in the conversation.",
			inputSchema: { id: z.string().describe("The thread ID") },
		},
		async ({ id }) =>
		{
			const thread = await DatabaseStore.find(Thread, id);
			if (!thread)
			{
				return text("Thread not found.");
			}
			const messages = await thread.messages({ includeHidden: false });
			return json({
				...formatThread(thread),
				messages: messages.map(formatMessage),
			});
		}
	);

	server.registerTool(
		"list_contacts",
		{
			description: "List or search contacts from the address book.",
			inputSchema: {
				search: z.string().optional().describe("Search by name or email"),
				limit: z.number().default(50).describe("Max results (1-200)"),
				offset: z.number().default(0).describe("Offset for pagination"),
			},
		},
		async ({ search, limit, offset }) =>
		{
			const contacts = await DatabaseStore.findAll(Contact).limit(2000);
			let filtered = contacts.filter(c => !c.hidden);
			if (search)
			{
				const q = search.toLowerCase();
				filtered = filtered.filter(c =>
					(c.email || "").toLowerCase().includes(q) ||
					(c.name || "").toLowerCase().includes(q)
				);
			}
			return json(filtered.slice(offset, offset + limit).map(c => ({
				id: c.id,
				email: c.email,
				name: c.name || "",
				refs: c.refs,
			})));
		}
	);

	server.registerTool("list_folders", { description: "List all email folders/mailboxes." }, async () =>
	{
		const folders = await DatabaseStore.findAll(Folder);
		return json(folders.map(f => ({
			id: f.id,
			path: f.path,
			role: f.role,
			accountId: f.accountId,
		})));
	});

	server.registerTool("list_labels", { description: "List all email labels (Gmail labels, etc.)." }, async () =>
	{
		const labels = await DatabaseStore.findAll(Label);
		return json(labels.map(l => ({
			id: l.id,
			path: l.path,
			role: l.role,
			accountId: l.accountId,
		})));
	});

	server.registerTool(
		"get_recent_emails",
		{
			description: "Get the most recent emails.",
			inputSchema: { limit: z.number().default(20).describe("Max results (1-200)") },
		},
		async ({ limit }) =>
		{
			const messages = await DatabaseStore.findAll(Message)
				.where([Message.attributes.draft.equal(false)])
				.order(Message.attributes.date.descending())
				.limit(limit);
			return json(messages.map(formatMessage));
		}
	);

	server.registerTool("list_drafts", { description: "List all draft emails." }, async () =>
	{
		const drafts = await DatabaseStore.findAll(Message)
			.where([Message.attributes.draft.equal(true)])
			.order(Message.attributes.date.descending());
		return json(drafts.map(formatMessage));
	});

	server.registerTool("email_stats", { description: "Get mailbox statistics." }, async () =>
	{
		const [messages, threads, contacts, folders, labels, unread] = await Promise.all([
			DatabaseStore.findAll(Message).count(),
			DatabaseStore.findAll(Thread).count(),
			DatabaseStore.findAll(Contact).count(),
			DatabaseStore.findAll(Folder).count(),
			DatabaseStore.findAll(Label).count(),
			DatabaseStore.findAll(Thread).where([Thread.attributes.unread.equal(true)]).count(),
		]);
		return json({ messages, threads, contacts, folders, labels, unreadThreads: unread });
	});

	return server;
}

function startServer(): void
{
	const mcpServer = createMcpServer();
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

	httpServer = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) =>
	{
		await transport.handleRequest(req, res);
	});

	httpServer.on('error', (err: NodeJS.ErrnoException) =>
	{
		if (err.code === 'EADDRINUSE')
		{
			console.log('[mailspring-mcp] Port already in use, server likely running in another window');
			return;
		}
		console.error('[mailspring-mcp] Server error:', err);
	});

	mcpServer.connect(transport);

	httpServer.listen(MCP_PORT, '127.0.0.1', () =>
	{
		console.log(`[mailspring-mcp] MCP server listening on http://127.0.0.1:${MCP_PORT}/mcp`);
	});
}

// --- Formatters ---

function formatThread(thread: MailspringThread)
{
	return {
		id: thread.id,
		subject: thread.subject,
		snippet: thread.snippet,
		lastMessage: new Date(thread.lastMessageReceivedTimestamp * 1000).toISOString(),
		participants: (thread.participants || []).map(formatContact),
		unread: !!thread.unread,
		starred: !!thread.starred,
		hasAttachments: !!thread.attachmentCount,
		folders: (thread.folders || []).map(f => f.path || f.displayName),
		labels: (thread.labels || []).map(l => l.path || l.displayName),
	};
}

function formatMessage(msg: MailspringMessage)
{
	return {
		id: msg.id,
		subject: msg.subject,
		date: new Date(msg.date * 1000).toISOString(),
		from: (msg.from || []).map(formatContact),
		to: (msg.to || []).map(formatContact),
		cc: msg.cc && msg.cc.length ? msg.cc.map(formatContact) : undefined,
		snippet: msg.snippet,
		unread: msg.unread,
		starred: msg.starred,
		draft: msg.draft,
		threadId: msg.threadId,
		folder: msg.folder && msg.folder.path,
	};
}

function formatContact(c: MailspringContact): string
{
	if (c.name)
	{
		return `${c.name} <${c.email}>`;
	}
	return c.email;
}

function json(data: unknown)
{
	return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function text(msg: string)
{
	return { content: [{ type: "text" as const, text: msg }] };
}

function stripHtml(html: string): string
{
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}
