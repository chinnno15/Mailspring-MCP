import http from 'http';
import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { DatabaseStore, AccountStore, Matcher, Thread, Message, Contact, Folder, Label, MailspringThread, MailspringMessage, MailspringContact, MailspringFile } from 'mailspring-exports';

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
	const server = new McpServer({ name: "mailspring", version: "2.0.0" });

	server.registerTool(
		"search_emails",
		{
			description: "Search emails with full-text search and optional structured filters. The query field supports FTS5 syntax: use OR for alternatives (interview OR callback), quoted phrases for exact match (\"phone screen\"), prefix matching (sched*), and NOT to exclude terms. Combine with structured filters for precise results.",
			inputSchema: {
				query: z.string().optional().describe("Full-text search query (supports FTS5: OR, NOT, quoted phrases, prefix*)"),
				from: z.string().optional().describe("Filter by sender email or name (partial match)"),
				to: z.string().optional().describe("Filter by recipient email or name (partial match)"),
				subject: z.string().optional().describe("Filter by subject (partial match)"),
				dateFrom: z.string().optional().describe("Start date (ISO 8601, e.g. '2026-03-01')"),
				dateTo: z.string().optional().describe("End date (ISO 8601, e.g. '2026-03-29')"),
				unread: z.boolean().optional().describe("Filter by unread status"),
				starred: z.boolean().optional().describe("Filter by starred status"),
				hasAttachment: z.boolean().optional().describe("Filter for emails with attachments"),
				folder: z.string().optional().describe("Filter by folder path (e.g. 'INBOX')"),
				label: z.string().optional().describe("Filter by label path"),
				limit: z.number().default(50).describe("Max results (1-500)"),
				offset: z.number().default(0).describe("Offset for pagination"),
			},
		},
		async (params) =>
		{
			const matchers = await buildThreadMatchers(params);
			let q = DatabaseStore.findAll(Thread);

			if (params.query)
			{
				q = q.search(params.query);
			}
			if (params.subject)
			{
				matchers.push(Thread.attributes.subject.like(params.subject));
			}
			if (matchers.length)
			{
				q = q.where(matchers);
			}

			let threads = await q
				.order(Thread.attributes.lastMessageReceivedTimestamp.descending())
				.limit(params.limit)
				.offset(params.offset);

			if (params.from || params.to)
			{
				threads = filterThreadsByParticipant(threads, params.from, params.to);
			}
			if (params.hasAttachment !== undefined)
			{
				threads = threads.filter(t => params.hasAttachment ? t.attachmentCount > 0 : t.attachmentCount === 0);
			}

			return json(await Promise.all(threads.map(enrichThread)));
		}
	);
	server.registerTool(
		"read_email",
		{
			description: "Read a specific email by its ID, including the full body content and attachment list.",
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

	server.registerTool(
		"list_threads",
		{
			description: "List email threads with filters for folder, label, unread/starred status, date range, and attachments. Returns enriched thread metadata including message count and last sender.",
			inputSchema: {
				folder: z.string().optional().describe("Filter by folder path (e.g. 'INBOX', 'Sent Mail')"),
				label: z.string().optional().describe("Filter by label path"),
				unread: z.boolean().optional().describe("Filter by unread status"),
				starred: z.boolean().optional().describe("Filter by starred status"),
				hasAttachment: z.boolean().optional().describe("Filter for threads with attachments"),
				dateFrom: z.string().optional().describe("Only threads with messages after this date (ISO 8601)"),
				dateTo: z.string().optional().describe("Only threads with messages before this date (ISO 8601)"),
				limit: z.number().default(25).describe("Max results (1-500)"),
				offset: z.number().default(0).describe("Offset for pagination"),
			},
		},
		async (params) =>
		{
			const matchers = await buildThreadMatchers(params);

			let q = DatabaseStore.findAll(Thread);
			if (matchers.length)
			{
				q = q.where(matchers);
			}
			let threads = await q
				.order(Thread.attributes.lastMessageReceivedTimestamp.descending())
				.limit(params.limit)
				.offset(params.offset);

			if (params.hasAttachment !== undefined)
			{
				threads = threads.filter(t => params.hasAttachment ? t.attachmentCount > 0 : t.attachmentCount === 0);
			}

			return json(await Promise.all(threads.map(enrichThread)));
		}
	);

	server.registerTool(
		"read_thread",
		{
			description: "Read a full email thread with all messages, body content, attachments, and reply status.",
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
			const myAddresses = new Set(AccountStore.accounts().map(a => a.emailAddress.toLowerCase()));
			const lastMsg = messages[messages.length - 1];
			const youRepliedLast = lastMsg ? (lastMsg.from || []).some(c => myAddresses.has(c.email.toLowerCase())) : false;

			return json({
				...formatThread(thread),
				messageCount: messages.length,
				youRepliedLast,
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
			description: "Get recent emails with optional date range filtering and pagination.",
			inputSchema: {
				limit: z.number().default(50).describe("Max results (1-500)"),
				offset: z.number().default(0).describe("Offset for pagination"),
				dateFrom: z.string().optional().describe("Only emails after this date (ISO 8601)"),
				dateTo: z.string().optional().describe("Only emails before this date (ISO 8601)"),
			},
		},
		async ({ limit, offset, dateFrom, dateTo }) =>
		{
			const matchers: any[] = [Message.attributes.draft.equal(false)];

			if (dateFrom)
			{
				matchers.push(Message.attributes.date.greaterThanOrEqualTo(new Date(dateFrom)));
			}
			if (dateTo)
			{
				matchers.push(Message.attributes.date.lessThanOrEqualTo(new Date(dateTo)));
			}

			const messages = await DatabaseStore.findAll(Message)
				.where(matchers)
				.order(Message.attributes.date.descending())
				.limit(limit)
				.offset(offset);
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

	// @ts-expect-error TS2589: Zod + MCP SDK deep type instantiation
	server.registerTool(
		"batch_read_emails",
		{
			description: "Read multiple emails at once by their IDs, including full body content and attachments. Use this to efficiently analyze or categorize a batch of emails instead of calling read_email repeatedly.",
			inputSchema: {
				ids: z.array(z.string()).describe("Array of message IDs to read"),
			},
		},
		async ({ ids }) =>
		{
			const results = await Promise.all(ids.map(async (id) =>
			{
				const msg = await DatabaseStore.find(Message, id)
					.include(Message.attributes.body);
				if (!msg)
				{
					return { id, error: "not found" };
				}
				return {
					...formatMessage(msg),
					body: stripHtml(msg.body || ""),
				};
			}));
			return json(results);
		}
	);

	return server;
}

// --- Query Helpers ---

interface ThreadFilterParams
{
	folder?: string;
	label?: string;
	unread?: boolean;
	starred?: boolean;
	hasAttachment?: boolean;
	dateFrom?: string;
	dateTo?: string;
}

async function buildThreadMatchers(params: ThreadFilterParams): Promise<any[]>
{
	const matchers: any[] = [];

	if (params.unread !== undefined)
	{
		matchers.push(Thread.attributes.unread.equal(params.unread));
	}
	if (params.starred !== undefined)
	{
		matchers.push(Thread.attributes.starred.equal(params.starred));
	}
	if (params.dateFrom)
	{
		matchers.push(Thread.attributes.lastMessageReceivedTimestamp.greaterThanOrEqualTo(new Date(params.dateFrom)));
	}
	if (params.dateTo)
	{
		matchers.push(Thread.attributes.lastMessageReceivedTimestamp.lessThanOrEqualTo(new Date(params.dateTo)));
	}
	if (params.folder)
	{
		const folders = await DatabaseStore.findAll(Folder);
		const match = folders.find(f => f.path.toLowerCase().includes(params.folder!.toLowerCase()));
		if (match)
		{
			matchers.push(Thread.attributes.categories.contains(match.id));
		}
	}
	if (params.label)
	{
		const labels = await DatabaseStore.findAll(Label);
		const match = labels.find(l => l.path.toLowerCase().includes(params.label!.toLowerCase()));
		if (match)
		{
			matchers.push(Thread.attributes.categories.contains(match.id));
		}
	}

	return matchers;
}

function filterThreadsByParticipant(threads: MailspringThread[], from?: string, to?: string): MailspringThread[]
{
	return threads.filter(thread =>
	{
		const participants = thread.participants || [];
		if (from)
		{
			const f = from.toLowerCase();
			const hasFrom = participants.some(p =>
				p.email.toLowerCase().includes(f) ||
				(p.name || "").toLowerCase().includes(f)
			);
			if (!hasFrom)
			{
				return false;
			}
		}
		if (to)
		{
			const t = to.toLowerCase();
			const hasTo = participants.some(p =>
				p.email.toLowerCase().includes(t) ||
				(p.name || "").toLowerCase().includes(t)
			);
			if (!hasTo)
			{
				return false;
			}
		}
		return true;
	});
}

async function enrichThread(thread: MailspringThread)
{
	const messages = await thread.messages({ includeHidden: false });
	const myAddresses = new Set(AccountStore.accounts().map(a => a.emailAddress.toLowerCase()));
	const lastMsg = messages[messages.length - 1];
	const youRepliedLast = lastMsg ? (lastMsg.from || []).some(c => myAddresses.has(c.email.toLowerCase())) : false;

	const files = messages.flatMap(m => m.files || []);

	return {
		...formatThread(thread),
		messageCount: messages.length,
		youRepliedLast,
		attachments: files.length ? files.map(formatFile) : undefined,
	};
}

function startServer(): void
{
	const mcpServer = createMcpServer();
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });

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
		lastMessage: new Date(thread.lastMessageReceivedTimestamp).toISOString(),
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
	const files = msg.files || [];
	return {
		id: msg.id,
		subject: msg.subject,
		date: new Date(msg.date).toISOString(),
		from: (msg.from || []).map(formatContact),
		to: (msg.to || []).map(formatContact),
		cc: msg.cc && msg.cc.length ? msg.cc.map(formatContact) : undefined,
		snippet: msg.snippet,
		unread: msg.unread,
		starred: msg.starred,
		draft: msg.draft,
		threadId: msg.threadId,
		folder: msg.folder && msg.folder.path,
		hasAttachments: files.length > 0,
		attachments: files.length ? files.map(formatFile) : undefined,
	};
}

function formatFile(f: MailspringFile)
{
	return {
		id: f.id,
		filename: f.filename,
		contentType: f.contentType,
		size: f.size,
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
