#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MailspringDb } from "./db.js";

const db = new MailspringDb();

const server = new McpServer({
  name: "mailspring",
  version: "1.0.0",
});

// --- Tools ---

server.tool(
  "search_emails",
  "Search through emails by keyword. Searches subjects and message content.",
  {
    query: z.string().describe("Search query string"),
    limit: z.number().min(1).max(200).default(25).describe("Max results to return"),
  },
  async ({ query, limit }) => {
    const messages = db.searchMessages(query, limit);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(messages.map(formatMessageSummary), null, 2),
      }],
    };
  }
);

server.tool(
  "read_email",
  "Read a specific email by its ID, including the full body content.",
  {
    id: z.string().describe("The message ID"),
  },
  async ({ id }) => {
    const message = db.getMessage(id);
    if (!message) {
      return { content: [{ type: "text", text: "Message not found." }] };
    }

    const body = message.body || "(no body available)";
    const stripped = stripHtml(body);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ...formatMessageSummary(message),
          body: stripped,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "list_threads",
  "List email threads with optional filters for folder, label, unread/starred status.",
  {
    folder: z.string().optional().describe("Filter by folder path (e.g. 'INBOX', '[Gmail]/Sent Mail')"),
    label: z.string().optional().describe("Filter by label path"),
    unread: z.boolean().optional().describe("Filter by unread status"),
    starred: z.boolean().optional().describe("Filter by starred status"),
    limit: z.number().min(1).max(200).default(25).describe("Max results"),
    offset: z.number().min(0).default(0).describe("Offset for pagination"),
  },
  async ({ folder, label, unread, starred, limit, offset }) => {
    const threads = db.listThreads({ folder, label, unread, starred, limit, offset });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(threads.map(formatThreadSummary), null, 2),
      }],
    };
  }
);

server.tool(
  "read_thread",
  "Read a full email thread including all messages in the conversation.",
  {
    id: z.string().describe("The thread ID"),
  },
  async ({ id }) => {
    const thread = db.getThread(id);
    if (!thread) {
      return { content: [{ type: "text", text: "Thread not found." }] };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ...formatThreadSummary(thread),
          messages: thread.messages.map(formatMessageSummary),
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "list_contacts",
  "List or search contacts from the Mailspring address book.",
  {
    search: z.string().optional().describe("Search by name or email"),
    limit: z.number().min(1).max(200).default(50).describe("Max results"),
    offset: z.number().min(0).default(0).describe("Offset for pagination"),
  },
  async ({ search, limit, offset }) => {
    const contacts = db.listContacts({ search, limit, offset });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(contacts, null, 2),
      }],
    };
  }
);

server.tool(
  "list_folders",
  "List all email folders/mailboxes.",
  {},
  async () => {
    const folders = db.listFolders();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(folders, null, 2),
      }],
    };
  }
);

server.tool(
  "list_labels",
  "List all email labels (Gmail labels, etc.).",
  {},
  async () => {
    const labels = db.listLabels();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(labels, null, 2),
      }],
    };
  }
);

server.tool(
  "get_recent_emails",
  "Get the most recent emails.",
  {
    limit: z.number().min(1).max(200).default(20).describe("Max results"),
  },
  async ({ limit }) => {
    const messages = db.getRecentMessages(limit);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(messages.map(formatMessageSummary), null, 2),
      }],
    };
  }
);

server.tool(
  "list_drafts",
  "List all draft emails.",
  {},
  async () => {
    const drafts = db.getDrafts();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(drafts.map(formatMessageSummary), null, 2),
      }],
    };
  }
);

server.tool(
  "email_stats",
  "Get overview statistics about the mailbox (message count, unread count, etc.).",
  {},
  async () => {
    const stats = db.getStats();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(stats, null, 2),
      }],
    };
  }
);

// --- Resources ---

server.resource(
  "mailbox-stats",
  "mailspring://stats",
  async (uri) => {
    const stats = db.getStats();
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(stats, null, 2),
      }],
    };
  }
);

// --- Helpers ---

function formatMessageSummary(msg: any) {
  return {
    id: msg.id,
    subject: msg.subject,
    date: new Date(msg.date * 1000).toISOString(),
    from: msg.from?.map((c: any) => c.name ? `${c.name} <${c.email}>` : c.email) || [],
    to: msg.to?.map((c: any) => c.name ? `${c.name} <${c.email}>` : c.email) || [],
    cc: msg.cc?.length ? msg.cc.map((c: any) => c.name ? `${c.name} <${c.email}>` : c.email) : undefined,
    snippet: msg.snippet,
    unread: msg.unread,
    starred: msg.starred,
    draft: msg.draft,
    threadId: msg.threadId,
    folder: msg.folder?.path,
    labels: msg.labels?.length ? msg.labels : undefined,
  };
}

function formatThreadSummary(thread: any) {
  return {
    id: thread.id,
    subject: thread.subject,
    snippet: thread.snippet,
    lastMessage: new Date(thread.lastMessageTimestamp * 1000).toISOString(),
    participants: thread.participants?.map((c: any) => c.name ? `${c.name} <${c.email}>` : c.email) || [],
    unread: !!thread.unread,
    starred: !!thread.starred,
    hasAttachments: !!thread.hasAttachments,
    folders: thread.folders?.map((f: any) => f.path) || [],
    labels: thread.labels?.map((l: any) => l.path) || [],
  };
}

function stripHtml(html: string): string {
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

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
