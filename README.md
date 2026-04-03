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

3. Restart Mailspring. The MCP server starts automatically on `http://127.0.0.1:2525/mcp`.

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
