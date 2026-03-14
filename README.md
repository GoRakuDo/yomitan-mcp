# Yomitan MCP Server

A Model Context Protocol (MCP) server that provides AI agents with direct access to your local Yomitan dictionary databases.

## Overview

This MCP server connects to the Yomitan browser extension's existing Native Messaging HTTP API (typically running on `localhost:19633`). It allows any MCP-compatible client (like OpenClaw, Claude Desktop, or Cursor) to perform rich dictionary lookups instantly, completely offline, and without any browser automation.

Managed by [GoRakuDo](https://gorakudo.org).

## Features (MCP Tools)

The server exposes 6 tools:

1. `lookup` — Search for a vocabulary word and return definitions, readings, and tags. (Optimized for AI context)
2. `kanji` — Search for detailed information about a single Kanji character.
3. `tokenize` — Parse a Japanese sentence into tokens and dictionary entries.
4. `anki_discover` — **(New in v1.2.0)** Auto-detect which Anki field markers (like `{expression}`, `{glossary}`) are valid in your specific Yomitan setup.
5. `anki_fields` — Generate populated Anki flashcard fields based on your Yomitan templates.
6. `status` — Check the connection status and version of your Yomitan backend.

## Prerequisites

1. **Yomitan Browser Extension** installed in Chrome/Firefox.
2. **Native Messaging** enabled in Yomitan.
3. **Yomitan API** enabled in Yomitan Settings:
   - Go to Yomitan Settings -> Advanced.
   - Enable "Yomitan API" (Ensure the server URL is `http://127.0.0.1:19633`).
4. **Node.js** (v18+) installed.

## Usage
 
 You can run this MCP server directly using `npx` (no installation required):
 
 ```bash
 npx yomitan-mcp-server
 ```
 
 ### Usage with MCP Clients (Claude Desktop, Cursor, OpenClaw, etc.)
 
 Add the following configuration to your MCP client's configuration file (e.g., `mcp_config.json`, `claude_desktop_config.json`):
 
 ```json
 {
   "mcpServers": {
     "yomitan-mcp": {
       "command": "npx",
       "args": [
         "-y",
         "yomitan-mcp-server@latest"
       ]
     }
   }
 }
 ```

## Anki Integration

To use `anki_fields` effectively:
1. Configure your Anki Note Type and field mappings in Yomitan Settings -> Anki -> "Configure Anki card format...".
2. Use `anki_discover` first to see which markers (e.g., `expression`, `reading`, `glossary`, `single-glossary-DictionaryName`) are available in your setup.
3. If you encounter HTTP 500 errors, ensure you are using the correct marker names found via `anki_discover`.

## Security & Privacy

- All lookups are performed entirely locally on your machine.
- No data is sent to external servers by this MCP server.
- The default HTTP API operates strictly on `localhost`.

## Troubleshooting

- **Connection Refused (`ECONNREFUSED`)**: Ensure the browser with Yomitan is running. Check that "Enable Yomitan API" is turned on in the extension's Advanced Settings.
- **HTTP 500 Errors in anki_fields**: This usually means a marker name is invalid or not mapped. Run `anki_discover` to verify your available markers.
- **Insufficient Permissions**: Ensure the Native Messaging component is correctly installed for your browser. You can test this within the Yomitan Settings page under "API".

---
Built by [GoRakuDo](https://gorakudo.org). Licensed under MIT.
