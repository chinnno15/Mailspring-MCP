# Mailspring MCP Server Plugin

A Mailspring plugin that runs an MCP (Model Context Protocol) server, giving AI agents read-only access to your email data — threads, messages, contacts, folders, and labels.

The plugin uses Mailspring's own `DatabaseStore` API, so there's no database path to configure and no external SQLite dependency.

## Install

1. Symlink the plugin into Mailspring's packages directory:

   ```bash
   ./install.sh
   ```

2. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

3. Restart Mailspring. The MCP server starts automatically on `http://127.0.0.1:2525/mcp`.

## VS Code MCP Configuration

Add to your `.vscode/mcp.json` (already included in this repo):

```json
{
  "mcpServers": {
    "mailspring": {
      "url": "http://127.0.0.1:2525/mcp"
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search_emails` | Full-text search with structured filters (from, to, subject, date range, folder, label, unread, starred, attachments). Supports FTS5 syntax: `OR`, `NOT`, quoted phrases, prefix matching. |
| `read_email` | Read a specific email with full body content and attachment list |
| `batch_read_emails` | Read multiple emails at once by ID — full body + attachments for each |
| `list_threads` | List threads with filters (folder, label, unread, starred, date range, attachments). Returns enriched metadata: message count, last sender, reply status. |
| `read_thread` | Read a full thread with all messages, reply status, and attachment details |
| `list_contacts` | List or search contacts by name/email |
| `list_folders` | List all mailbox folders |
| `list_labels` | List all email labels |
| `get_recent_emails` | Get recent emails with date range filtering and pagination |
| `list_drafts` | List draft emails |
| `email_stats` | Get mailbox statistics |

## How It Works

On `activate()`, the plugin starts an HTTP server on port 2525 that speaks the MCP protocol via Streamable HTTP transport. All queries go through Mailspring's `DatabaseStore` — the same read-only API that Mailspring's own UI uses. No direct SQLite access needed.

On `deactivate()` (or when Mailspring shuts down), the HTTP server is cleaned up.

To get started, run `npm install` in your plugin's directory and then `npm run-script build` to compile the `src` folder into the `lib` folder. To see your changes in Mailspring, quit and relaunch the app OR open the developer tools and reload the app's main window.

For documentation of how to build plugins, check out [https://foundry376.github.io/Mailspring/](https://foundry376.github.io/Mailspring/) for (slightly outdated) information and also have a look at the many plugins that ship within the core app: [https://github.com/Foundry376/Mailspring/tree/master/app/internal_packages](https://github.com/Foundry376/Mailspring/tree/master/app/internal_packages). Some of the bundled plugins, like `composer-translate`, `composer-templates`, and `phishing-detection` are great starting points!

## Mailspring-specific package.json Options

### `windowTypes`

The `windowTypes` field controls which Mailspring windows your plugin is loaded into. Each key is a window type and the value should be `true` to opt in. Available window types:

- `default` — the primary application window (mail list, message viewer, sidebar, etc.)
- `composer` — the composer window when composing a new message
- `thread-popout` — a thread viewed in its own separate window
- `calendar` — the freestanding calendar window

If `windowTypes` is omitted, the plugin will not be loaded in any window. Most plugins only need `default`; only include additional window types if your plugin registers components or functionality relevant to those windows.

### `syncInit`

By default, Mailspring delays loading plugins by ~2 seconds after launch so that the core UI can appear quickly. Setting `syncInit: true` in your `package.json` causes the plugin to activate immediately on startup instead:

```json
"syncInit": true
```

Use this only if your plugin must be active before the UI is usable (for example, if it registers a data store or API that other components depend on at startup). Unnecessary use of `syncInit` will slow down Mailspring's launch time.

## Shipping a Plugin

Mailspring does not transpile the source code in your plugin when it runs - it expects that your JSX files, TypeScript, etc. has already been converted to plain ES2017 JavaScript. To give your plugin to other people, you should commit the `lib` directory so that they can download the repository, put it in place via the "Install a Plugin..." menu item in Mailspring, and be done.

## Future

In the next year or so, we'll be launching a first-class "plugin gallery" in Mailspring and formalizing the development and release processes. Right now, building a plugin using TypeScript is a real pain because Mailspring - while written in TypeScript - doesn't export the types for you to build against. Stay tuned!

## A note about Node Modules

Right now, if your plugin depends on external node modules (say, a CSV parser like `node-csv`), you'd need to package up a zip file that contained those modules already installed in `node_modules`, or have your users run `npm install`. In the future, Mailspring will run npm install for you.

However, we do not plan to support Mailspring plugins that require _native_ node modules - the kind that compile C++ or C code into platform-specific binaries. It's really hard to ship all of the tooling required to build these reliably, pre-packing them for each platform is annoying, and they often break when the node / nan versions change. Be warned! (An example of this would be `sqlite` or something like `node-addressbook`. You can often tell if a module contains native code if there is a `binding.gyp` file or if the install process takes a while and calls out to `make` or `gcc`.)
