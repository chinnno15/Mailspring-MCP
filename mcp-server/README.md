# Mailspring MCP Server

An MCP (Model Context Protocol) server that provides read-only access to your Mailspring email database. This allows AI agents to search, read, and browse your emails, threads, contacts, and labels.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## MCP Configuration

Add to your VS Code `settings.json` or `.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "mailspring": {
      "command": "node",
      "args": ["/home/scott/Documents/repos/DEV/Mailspring-Plugin-Starter/mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

If your Mailspring database is in a non-standard location, set the `MAILSPRING_DB_PATH` environment variable:

```json
{
  "mcpServers": {
    "mailspring": {
      "command": "node",
      "args": ["/home/scott/Documents/repos/DEV/Mailspring-Plugin-Starter/mcp-server/dist/index.js"],
      "env": {
        "MAILSPRING_DB_PATH": "/path/to/edgehill.db"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search_emails` | Search emails by keyword (subjects and content) |
| `read_email` | Read a specific email with full body |
| `list_threads` | List threads with filters (folder, label, unread, starred) |
| `read_thread` | Read a full thread with all messages |
| `list_contacts` | List or search contacts |
| `list_folders` | List all mailbox folders |
| `list_labels` | List all email labels |
| `get_recent_emails` | Get the most recent emails |
| `list_drafts` | List draft emails |
| `email_stats` | Get mailbox statistics |

## Notes

- This server provides **read-only** access to the Mailspring SQLite database
- The database is auto-detected from standard Mailspring install locations (Flatpak, native Linux, macOS, Windows)
- Email bodies are stripped of HTML tags for cleaner text output
