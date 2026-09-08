# Mailspring MCP Server Plugin

A Mailspring plugin that runs an MCP (Model Context Protocol) server, giving AI agents read-only access to your email data — threads, messages, contacts, folders, and labels.

The plugin uses Mailspring's own `DatabaseStore` API, making setup easy and seamless.


## Installation

Use this if you want to install the plugin into Mailspring and run it normally.

1. Install dependencies and build the plugin:

  ```bash
  npm install
  npm run build
  ```

2. Install the built plugin into Mailspring through Mailspring's plugin install flow, or place the built plugin directory in Mailspring's `packages` directory.

3. Restart Mailspring.

### Tests

```bash
npm test        # builds, then runs unit + integration tests
npm run test:unit   # unit tests only, no running Mailspring needed
```

The integration tests exercise the live MCP endpoint on `127.0.0.1:2525` and skip automatically
when Mailspring is not running. The MCP server starts automatically on `http://127.0.0.1:2525/mcp`.

## Authentication

The server binds loopback only, but loopback is not a trust boundary — every process on the
machine can reach it, and these tools can mutate mail. Requests must therefore present a shared
bearer token.

On first launch the plugin generates one into Mailspring's config directory as
`mailspring-mcp-token`, mode `0600`. Pass it to your client as an `Authorization` header:

```bash
claude mcp add --scope user --transport http mailspring http://127.0.0.1:2525/mcp \
  --header "Authorization: Bearer $(cat ~/.config/Mailspring/mailspring-mcp-token)"
```

This is deliberately **not** the OAuth 2.1 flow the MCP spec defines for remote servers. There is no
third party to delegate to and no consent to obtain for a single-user process on loopback, so a
static token is the proportionate control. Note that a client which connects *without* the token
receives a 401 and may then attempt OAuth discovery, which will fail — if you see a registration
error, the token is missing or stale rather than the server being broken.

Requests are also checked for DNS rebinding: the `Host` header must be loopback, and a cross-site
`Origin` is refused. Clients that send no `Origin` (any non-browser client) are unaffected.

## MCP Configuration

Import the configuration using the following JSON snippet, example vscode snippet included in repo:
```json
{
  "mcpServers": {
    "mailspring": {
      "url": "http://127.0.0.1:2525/mcp"
    }
  }
}
```

## Development

Use this if you are actively working on the plugin code.

1. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

2. Link the repo into Mailspring's `packages` directory so Mailspring loads your working copy:

  ```bash
  ./install.sh
  ```

3. Restart Mailspring.

### Tests

```bash
npm test        # builds, then runs unit + integration tests
npm run test:unit   # unit tests only, no running Mailspring needed
```

The integration tests exercise the live MCP endpoint on `127.0.0.1:2525` and skip automatically
when Mailspring is not running.



## Available Tools

| Tool | Description |
|------|-------------|
| `search_emails` | Full-text search with structured filters (from, to, subject, date range, folder, label, unread, starred, attachments). Supports FTS5 syntax: `OR`, `NOT`, quoted phrases, prefix matching. |
| `read_email` | Read a specific email with full plain-text body content and attachment list |
| `batch_read_emails` | Read multiple emails at once by ID — full body + attachments for each |
| `list_threads` | List threads with filters (folder, label, unread, starred, date range, attachments). Returns enriched metadata: message count, last sender, reply status. |
| `read_thread` | Read a full thread with all messages, reply status, attachment details, sanitized `bodyHtml`, and stripped plain-text `body` |
| `list_contacts` | List or search contacts by name/email |
| `list_folders` | List all mailbox folders |
| `list_labels` | List all email labels |
| `get_recent_emails` | Get recent emails with date range filtering and pagination |
| `list_drafts` | List draft emails with pagination |
| `email_stats` | Get mailbox statistics |
| `count_threads` | Count threads matching a filter without fetching them. Returns totals and a per-account breakdown. |
| `grep_threads` | Regex search over message bodies, subjects and senders. Returns thread IDs and match counts rather than content, so it stays small. Answers what FTS cannot — "which threads mention @someone". |
| `sync_status` | Pending task queue. The mutation tools return once tasks are *queued*, not once they have reached the provider — poll until `idle` before treating a bulk change as landed. |

`list_threads` and `search_emails` take `compact: true` for a much smaller row
(`{id, accountId, from, subject, date, unread, messageCount}`), and
`includeMessageSubjects: true` to get every message subject in a thread rather
than only the newest — needed to classify a thread by its whole history.

> **Note on `grep_threads` and GitHub mail:** a GitHub notification embeds the
> comment author's avatar as `alt="@username"`, so a bare `@username` pattern
> matches threads *you wrote* as well as threads that mention you. Match the
> link form (`github.com/<user>">@<user>`) when you specifically want mentions.

### Mutations

These two go through Mailspring's own `TaskFactory` and task queue, so they sync back to the
provider exactly as the UI's buttons do, group correctly across multiple accounts, and remain
undoable from Mailspring. Neither permanently deletes anything.

| Tool | Description |
|------|-------------|
| `archive_threads` | Archive threads by ID. On Gmail accounts this removes the `INBOX` label rather than moving folders. Accepts up to 200 IDs per call. |
| `trash_threads` | Move threads to Trash by ID. Recoverable until the provider purges Trash (30 days on Gmail). Accepts up to 200 IDs per call. |
| `unarchive_threads` | Move threads back into the inbox — the inverse of `archive_threads`, and also how you pull a thread back out of Trash. On Gmail this restores the `INBOX` label, moving the thread out of Trash or Spam first when needed. Accepts up to 200 IDs per call. |

Each reports `{ requested, matched, archived|trashed|movedToInbox, tasksQueued, missing }` so a
caller can tell which IDs matched nothing.

**`dryRun: true`** resolves the threads and builds the tasks but queues nothing, returning the
counts a real run would produce plus a per-thread `preview` with a `covered` flag. Use it before
any bulk change.

The counts report what will actually **move**, not what merely matched. TaskFactory yields no task
for an account lacking a suitable category, so those threads are listed in `unaffected` /
`unaffectedAccounts` and excluded from the count — a batch spanning accounts can no longer report
success while silently leaving one account untouched.
