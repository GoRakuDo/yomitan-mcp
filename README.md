# Yomitan MCP Server

A Model Context Protocol (MCP) server that provides AI agents with direct access to your local Yomitan dictionary databases.

## Overview

This MCP server connects to the Yomitan browser extension's existing Native Messaging HTTP API (typically running on `localhost:19633`). It allows any MCP-compatible client (like OpenClaw, Claude Desktop, or Cursor) to perform rich dictionary lookups instantly, completely offline, and without any browser automation.

## Features (MCP Tools)

The server exposes 5 tools:

1. `lookup` — Search for a vocabulary word and return definitions, readings, and tags.
2. `kanji` — Search for detailed information about a single Kanji character.
3. `tokenize` — Parse a Japanese sentence into tokens and dictionary entries (using Yomitan's internal parser or MeCab).
4. `anki_fields` — Generate populated Anki flashcard fields based on your Yomitan templates.
5. `status` — Check the connection status and version of your Yomitan backend.

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
 
 ## Security & Privacy
 
 - All lookups are performed entirely locally on your machine.
 - No data is sent to external servers by this MCP server.
 - The default HTTP API operates strictly on `localhost`.

## Troubleshooting

- **Connection Refused (`ECONNREFUSED`)**: Ensure the browser with Yomitan is running. Check that "Enable Yomitan API" is turned on in the extension's Advanced Settings.
- **Insufficient Permissions**: Ensure the Native Messaging component is correctly installed for your browser. You can test this within the Yomitan Settings page under "API".
