import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

export interface MailspringMessage {
  id: string;
  accountId: string;
  subject: string;
  date: number;
  draft: boolean;
  unread: boolean;
  starred: boolean;
  threadId: string;
  snippet: string;
  from: { name: string; email: string }[];
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  bcc: { name: string; email: string }[];
  labels: string[];
  folder: { path: string; role: string } | null;
  plaintext: boolean;
  replyToHeaderMessageId: string | null;
}

export interface MailspringThread {
  id: string;
  accountId: string;
  subject: string;
  snippet: string;
  unread: number;
  starred: number;
  firstMessageTimestamp: number;
  lastMessageTimestamp: number;
  lastMessageReceivedTimestamp: number;
  participants: { name: string; email: string }[];
  hasAttachments: number;
  folders: { path: string; role: string }[];
  labels: { path: string; role: string }[];
}

export interface MailspringContact {
  id: string;
  email: string;
  name: string;
  refs: number;
  source: string;
}

export interface MailspringFolder {
  id: string;
  path: string;
  role: string;
  accountId: string;
}

export interface MailspringLabel {
  id: string;
  path: string;
  role: string;
  accountId: string;
}

function findMailspringDb(): string {
  const candidates = [
    // Flatpak (Linux)
    path.join(os.homedir(), ".var/app/com.getmailspring.Mailspring/config/Mailspring/edgehill.db"),
    // Standard Linux
    path.join(os.homedir(), ".config/Mailspring/edgehill.db"),
    // macOS
    path.join(os.homedir(), "Library/Application Support/Mailspring/edgehill.db"),
    // Windows (via WSL or native)
    path.join(os.homedir(), "AppData/Roaming/Mailspring/edgehill.db"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Mailspring database not found. Searched:\n${candidates.join("\n")}\n\nSet MAILSPRING_DB_PATH environment variable to specify the path.`
  );
}

export class MailspringDb {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || process.env.MAILSPRING_DB_PATH || findMailspringDb();
    this.db = new Database(resolvedPath, { readonly: true });
    this.db.pragma("journal_mode = WAL");
  }

  close() {
    this.db.close();
  }

  private parseMessageData(data: string): Partial<MailspringMessage> {
    const parsed = JSON.parse(data);
    return {
      snippet: parsed.snippet || "",
      from: parsed.from || [],
      to: parsed.to || [],
      cc: parsed.cc || [],
      bcc: parsed.bcc || [],
      labels: parsed.labels || [],
      folder: parsed.folder ? { path: parsed.folder.path, role: parsed.folder.role } : null,
      plaintext: parsed.plaintext || false,
      replyToHeaderMessageId: parsed.rthMsgId || null,
    };
  }

  private parseThreadData(data: string): Partial<MailspringThread> {
    const parsed = JSON.parse(data);
    return {
      folders: (parsed.folders || []).map((f: any) => ({ path: f.path, role: f.role })),
      labels: (parsed.labels || []).map((l: any) => ({ path: l.path, role: l.role })),
    };
  }

  searchMessages(query: string, limit: number = 50): MailspringMessage[] {
    const stmt = this.db.prepare(`
      SELECT m.id, m.accountId, m.subject, m.date, m.draft, m.unread, m.starred, m.threadId, m.data
      FROM Message m
      JOIN ThreadSearch ts ON ts.rowid IN (
        SELECT rowid FROM ThreadSearch WHERE ThreadSearch MATCH ?
      )
      JOIN Thread t ON t.searchRowId = ts.rowid
      WHERE m.threadId = t.id
      ORDER BY m.date DESC
      LIMIT ?
    `);

    // Fall back to LIKE-based search if FTS fails
    try {
      const rows = stmt.all(query, limit) as any[];
      return rows.map((row) => this.buildMessage(row));
    } catch {
      return this.searchMessagesLike(query, limit);
    }
  }

  private searchMessagesLike(query: string, limit: number): MailspringMessage[] {
    const pattern = `%${query}%`;
    const stmt = this.db.prepare(`
      SELECT id, accountId, subject, date, draft, unread, starred, threadId, data
      FROM Message
      WHERE subject LIKE ? OR data LIKE ?
      ORDER BY date DESC
      LIMIT ?
    `);
    const rows = stmt.all(pattern, pattern, limit) as any[];
    return rows.map((row) => this.buildMessage(row));
  }

  private buildMessage(row: any): MailspringMessage {
    const extra = this.parseMessageData(row.data);
    return {
      id: row.id,
      accountId: row.accountId,
      subject: row.subject,
      date: row.date,
      draft: !!row.draft,
      unread: !!row.unread,
      starred: !!row.starred,
      threadId: row.threadId,
      snippet: extra.snippet || "",
      from: extra.from || [],
      to: extra.to || [],
      cc: extra.cc || [],
      bcc: extra.bcc || [],
      labels: extra.labels || [],
      folder: extra.folder || null,
      plaintext: extra.plaintext || false,
      replyToHeaderMessageId: extra.replyToHeaderMessageId || null,
    };
  }

  getMessage(id: string): (MailspringMessage & { body: string | null }) | null {
    const stmt = this.db.prepare(`
      SELECT m.id, m.accountId, m.subject, m.date, m.draft, m.unread, m.starred, m.threadId, m.data,
             mb.value as body
      FROM Message m
      LEFT JOIN MessageBody mb ON mb.id = m.id
      WHERE m.id = ?
    `);
    const row = stmt.get(id) as any;
    if (!row) {
      return null;
    }
    return { ...this.buildMessage(row), body: row.body || null };
  }

  listThreads(options: {
    folder?: string;
    label?: string;
    unread?: boolean;
    starred?: boolean;
    limit?: number;
    offset?: number;
  } = {}): MailspringThread[] {
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.unread !== undefined) {
      conditions.push("t.unread = ?");
      params.push(options.unread ? 1 : 0);
    }
    if (options.starred !== undefined) {
      conditions.push("t.starred = ?");
      params.push(options.starred ? 1 : 0);
    }
    if (options.folder) {
      conditions.push("EXISTS (SELECT 1 FROM ThreadCategory tc JOIN Folder f ON tc.value = f.id WHERE tc.id = t.id AND f.path LIKE ?)");
      params.push(`%${options.folder}%`);
    }
    if (options.label) {
      conditions.push("EXISTS (SELECT 1 FROM ThreadCategory tc JOIN Label l ON tc.value = l.id WHERE tc.id = t.id AND l.path LIKE ?)");
      params.push(`%${options.label}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const stmt = this.db.prepare(`
      SELECT t.id, t.accountId, t.subject, t.snippet, t.unread, t.starred,
             t.firstMessageTimestamp, t.lastMessageTimestamp, t.lastMessageReceivedTimestamp,
             t.participants, t.hasAttachments, t.data
      FROM Thread t
      ${where}
      ORDER BY t.lastMessageTimestamp DESC
      LIMIT ? OFFSET ?
    `);

    params.push(limit, offset);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => {
      const extra = this.parseThreadData(row.data);
      let participants: { name: string; email: string }[] = [];
      if (row.participants) {
        try {
          participants = JSON.parse(row.participants);
        } catch {
          // participants stored as text
        }
      }

      return {
        id: row.id,
        accountId: row.accountId,
        subject: row.subject,
        snippet: row.snippet,
        unread: row.unread,
        starred: row.starred,
        firstMessageTimestamp: row.firstMessageTimestamp,
        lastMessageTimestamp: row.lastMessageTimestamp,
        lastMessageReceivedTimestamp: row.lastMessageReceivedTimestamp,
        participants,
        hasAttachments: row.hasAttachments,
        folders: extra.folders || [],
        labels: extra.labels || [],
      };
    });
  }

  getThread(id: string): (MailspringThread & { messages: MailspringMessage[] }) | null {
    const stmt = this.db.prepare(`
      SELECT t.id, t.accountId, t.subject, t.snippet, t.unread, t.starred,
             t.firstMessageTimestamp, t.lastMessageTimestamp, t.lastMessageReceivedTimestamp,
             t.participants, t.hasAttachments, t.data
      FROM Thread t
      WHERE t.id = ?
    `);
    const row = stmt.get(id) as any;
    if (!row) {
      return null;
    }

    const extra = this.parseThreadData(row.data);
    let participants: { name: string; email: string }[] = [];
    if (row.participants) {
      try {
        participants = JSON.parse(row.participants);
      } catch {
        // participants stored as text
      }
    }

    const msgStmt = this.db.prepare(`
      SELECT id, accountId, subject, date, draft, unread, starred, threadId, data
      FROM Message
      WHERE threadId = ?
      ORDER BY date ASC
    `);
    const messages = (msgStmt.all(id) as any[]).map((r) => this.buildMessage(r));

    return {
      id: row.id,
      accountId: row.accountId,
      subject: row.subject,
      snippet: row.snippet,
      unread: row.unread,
      starred: row.starred,
      firstMessageTimestamp: row.firstMessageTimestamp,
      lastMessageTimestamp: row.lastMessageTimestamp,
      lastMessageReceivedTimestamp: row.lastMessageReceivedTimestamp,
      participants,
      hasAttachments: row.hasAttachments,
      folders: extra.folders || [],
      labels: extra.labels || [],
      messages,
    };
  }

  listContacts(options: { search?: string; limit?: number; offset?: number } = {}): MailspringContact[] {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    let query: string;
    let params: any[];

    if (options.search) {
      const pattern = `%${options.search}%`;
      query = `
        SELECT id, email, data, refs
        FROM Contact
        WHERE hidden = 0 AND (email LIKE ? OR data LIKE ?)
        ORDER BY refs DESC
        LIMIT ? OFFSET ?
      `;
      params = [pattern, pattern, limit, offset];
    } else {
      query = `
        SELECT id, email, data, refs
        FROM Contact
        WHERE hidden = 0
        ORDER BY refs DESC
        LIMIT ? OFFSET ?
      `;
      params = [limit, offset];
    }

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map((row) => {
      let name = "";
      let source = "mail";
      try {
        const data = JSON.parse(row.data);
        name = data.name || "";
        source = data.s || "mail";
      } catch {
        // binary or invalid data
      }
      return {
        id: row.id,
        email: row.email,
        name,
        refs: row.refs,
        source,
      };
    });
  }

  listFolders(): MailspringFolder[] {
    const rows = this.db.prepare("SELECT id, path, role, accountId FROM Folder ORDER BY path").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      role: row.role || "",
      accountId: row.accountId,
    }));
  }

  listLabels(): MailspringLabel[] {
    const rows = this.db.prepare("SELECT id, path, role, accountId FROM Label ORDER BY path").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      role: row.role || "",
      accountId: row.accountId,
    }));
  }

  getStats(): { messages: number; threads: number; contacts: number; folders: number; labels: number; unreadThreads: number } {
    const count = (table: string) => (this.db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as any).c;
    const unread = (this.db.prepare("SELECT COUNT(*) as c FROM Thread WHERE unread > 0").get() as any).c;
    return {
      messages: count("Message"),
      threads: count("Thread"),
      contacts: count("Contact"),
      folders: count("Folder"),
      labels: count("Label"),
      unreadThreads: unread,
    };
  }

  getRecentMessages(limit: number = 20): MailspringMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, accountId, subject, date, draft, unread, starred, threadId, data
      FROM Message
      WHERE draft = 0
      ORDER BY date DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map((row) => this.buildMessage(row));
  }

  getDrafts(): MailspringMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, accountId, subject, date, draft, unread, starred, threadId, data
      FROM Message
      WHERE draft = 1
      ORDER BY date DESC
    `);
    const rows = stmt.all() as any[];
    return rows.map((row) => this.buildMessage(row));
  }
}
