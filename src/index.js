#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { YomitanClient } from "./yomitan-client.js";

// Structured JSON Logger
function log(level, message, data = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data
  };
  process.stderr.write(JSON.stringify(logEntry) + "\n");
}

// Initialize Yomitan Client
const client = new YomitanClient();

// Create MCP Server
const server = new McpServer({
  name: "yomitan-mcp",
  version: "1.1.0"
});

// --- Response Optimization Utilities ---
// Extract plain text from Yomitan's structured-content (recursive)
function extractText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object") {
    if (node.type === "structured-content" && node.content) return extractText(node.content);
    if (node.content) return extractText(node.content);
    if (node.tag && node.content) return extractText(node.content);
  }
  return "";
}

// Slim down a dictionary entry for AI consumption
function slimEntry(entry) {
  if (typeof entry === "string") return entry;
  if (entry && entry.type === "structured-content") return extractText(entry.content);
  return String(entry ?? "");
}

// Optimize lookup response: strip rendering metadata, keep semantics
function optimizeLookupResponse(data) {
  // If data is an array (e.g. from /termEntries endpoints returning multiple results), process each
  if (Array.isArray(data)) {
    return data.map(optimizeLookupResponse);
  }
  
  if (!data?.dictionaryEntries) return data;
  return {
    entries: data.dictionaryEntries.map(e => ({
      headwords: e.headwords?.map(h => ({
        term: h.term,
        reading: h.reading,
        wordClasses: h.wordClasses
      })),
      definitions: e.definitions?.map(d => ({
        dictionary: d.dictionary,
        glossary: d.entries?.map(slimEntry)
      })),
      frequencies: e.frequencies?.map(f => ({
        dictionary: f.dictionary,
        value: f.displayValue ?? f.frequency
      })),
      pronunciations: e.pronunciations?.map(p => ({
        dictionary: p.dictionary,
        pitchAccents: p.pronunciations?.map(pa => pa.positions)
      })),
      inflections: e.inflectionRuleChainCandidates?.[0]?.inflectionRules
    }))
  };
}

// Optimize tokenize response
function optimizeTokenizeResponse(data) {
  if (!Array.isArray(data)) return data;
  return data.map(parser => ({
    id: parser.id,
    tokens: parser.content?.map(token =>
      token.map(t => ({ text: t.text, reading: t.reading || undefined }))
        .filter(t => t.text)
    )
  }));
}

// Known Anki field markers for auto-discovery probing
const KNOWN_MARKERS = [
  "expression", "reading", "glossary", "sentence", "tags",
  "furigana-plain", "furigana-html",
  "pitch-accent-graphs", "pitch-accent-positions",
  "audio", "screenshot", "document-title",
  "clipboard-text", "clipboard-image",
  "cloze-prefix", "cloze-body", "cloze-suffix",
  "dictionary", "frequencies", "popup-selection-text",
  "sentence-furigana",
];

// Helper for error handling
const handleApiError = (error, action) => {
  log("error", "Yomitan API Error", { action, error: error.message, stack: error.stack });
  
  let hint = "";
  if (error.message.includes("ECONNREFUSED") || error.message.includes("Failed to connect")) {
    hint = "\n\n💡 HINT for AI Agent: The Yomitan API server is unreachable. Please instruct the user to:\n1. Open their browser (Chrome/Firefox) and ensure it is not suspended.\n2. Ensure the Yomitan extension is active.\n3. Verify that 'Enable Yomitan API' is checked in Yomitan Settings -> Advanced -> API.";
  } else if (error.message.includes("timeout")) {
    hint = "\n\n💡 HINT for AI Agent: The request to Yomitan timed out. The browser might be sleeping, or Yomitan's Native Messaging host is unresponsive. Ask the user to click into their browser to wake it up or restart the browser.";
  } else if (error.message.includes("status: 500")) {
    hint = "\n\n💡 HINT for AI Agent: Yomitan returned an internal error (HTTP 500). This occurs when the Yomitan extension itself errors out. Common causes: missing dictionaries (e.g., trying to use 'kanji' tool without a Kanji dictionary installed in Yomitan) or an invalid search term format.";
  } else if (error.message.includes("status: 404")) {
    hint = "\n\n💡 HINT for AI Agent: Endpoint not found (HTTP 404). This implies the Yomitan API is running, but the specific feature/endpoint is missing. The user's Yomitan extension version might be too old.";
  } else if (error.message.includes("fetch failed")) {
    hint = "\n\n💡 HINT for AI Agent: Failed to fetch data from localhost. The browser is likely closed or the Yomitan extension is disabled.";
  }

  return {
    content: [{ type: "text", text: `Error executing ${action}: ${error.message}${hint}` }],
    isError: true
  };
};

// 1. lookup (renamed from yomitan_lookup)
server.tool(
  "lookup",
  "Yomitanの辞書でterm/wordを検索し、定義・読み・タグ等を返す",
  {
    term: z.string().describe("検索する語句（例: 食べる）")
  },
  async ({ term }) => {
    log("info", "Executing lookup", { term });
    try {
      const response = await client.findTerms(term);
      const optimized = optimizeLookupResponse(response);
      return {
        content: [{ type: "text", text: JSON.stringify(optimized ?? null) }]
      };
    } catch (error) {
      return handleApiError(error, "lookup");
    }
  }
);

// 2. kanji (renamed from yomitan_kanji)
server.tool(
  "kanji",
  "漢字の詳細情報（読み、画数、意味等）を検索する",
  {
    character: z.string().refine(s => [...s].length === 1, "単一の漢字のみ受け付けます（サロゲートペア対応）").describe("単一の漢字（例: 食, 𠮷）")
  },
  async ({ character }) => {
    log("info", "Executing kanji lookup", { character });
    try {
      const response = await client.findKanji(character);
      return {
        content: [{ type: "text", text: JSON.stringify(response ?? null) }]
      };
    } catch (error) {
      return handleApiError(error, "kanji");
    }
  }
);

// 3. tokenize (renamed from yomitan_tokenize)
server.tool(
  "tokenize",
  "テキストを形態素解析し、読みと辞書エントリに分割する",
  {
    text: z.string().describe("解析する日本語テキスト"),
    scanLength: z.number().optional().default(20).describe("スキャン長（デフォルト: 20）"),
    parser: z.enum(["internal", "mecab"]).optional().default("internal").describe("パーサー（デフォルト: internal）")
  },
  async ({ text, scanLength, parser }) => {
    log("info", "Executing tokenize", { textLength: [...text].length, parser });
    try {
      const response = await client.tokenizeText(text, scanLength, parser);
      const optimized = optimizeTokenizeResponse(response);
      return {
        content: [{ type: "text", text: JSON.stringify(optimized ?? null) }]
      };
    } catch (error) {
      return handleApiError(error, "tokenize");
    }
  }
);

// 4. anki_fields (renamed from yomitan_anki_fields)
server.tool(
  "anki_fields",
  `Generate Anki flashcard field data from text using Yomitan's configured Anki templates.

⚠️ IMPORTANT FOR AI AGENTS: The 'markers' parameter must match the markers configured in the user's Yomitan Anki settings.
Common valid markers: expression, reading, glossary, sentence, tags, furigana-plain, furigana-html, pitch-accent-graphs, pitch-accent-positions, audio, popup-selection-text, frequencies, dictionary.
Do NOT use 'headword' — use 'expression' instead.
If unsure which markers are available, call the 'anki_discover' tool first to auto-detect valid markers.
If you get HTTP 500 errors, the markers you requested likely do not exist in the user's Yomitan Anki configuration.`,
  {
    text: z.string().describe("The Japanese text to generate Anki card data for (e.g. 食べる)"),
    type: z.enum(["term", "kanji"]).optional().default("term").describe("Entry type: 'term' for vocabulary, 'kanji' for kanji"),
    markers: z.array(z.string()).describe("Anki field markers to generate. Use 'anki_discover' tool first to find valid markers. Common: ['expression', 'furigana-plain', 'glossary', 'sentence']"),
    maxEntries: z.number().optional().default(1).describe("Maximum number of entries to generate"),
    includeMedia: z.boolean().optional().default(false).describe("Whether to include media (audio, etc.)")
  },
  async ({ text, type, markers, maxEntries, includeMedia }) => {
    log("info", "Executing anki_fields", { textLength: [...text].length, type, markers });
    try {
      const response = await client.getAnkiFields(text, type, markers, maxEntries, includeMedia);
      return {
        content: [{ type: "text", text: JSON.stringify(response ?? null) }]
      };
    } catch (error) {
      // Enhanced error for anki_fields specifically
      if (error.message.includes("status: 500")) {
        const ankiHint = `Error executing anki_fields: ${error.message}\n\n` +
          `💡 HINT for AI Agent: HTTP 500 from ankiFields usually means the markers you requested do not exist in the user's Yomitan Anki configuration.\n` +
          `1. First, try calling the 'anki_discover' tool to auto-detect which markers are valid.\n` +
          `2. Common mistake: using 'headword' instead of 'expression'. Use 'expression' for the word field.\n` +
          `3. If auto-discovery also fails, ask your human (user) to screenshot the Yomitan Anki configuration:\n` +
          `   → Open Yomitan Settings → Anki → "Configure Anki card format..."\n` +
          `   → Screenshot ALL fields in the popup window, scrolling to the bottom to capture every field mapping.\n` +
          `   → The 'Value' column shows which {markers} are mapped (e.g. {expression}, {furigana-plain}, {glossary}).\n` +
          `   → Use ONLY the marker names shown in the Value column (without curly braces).`;
        return { content: [{ type: "text", text: ankiHint }], isError: true };
      }
      return handleApiError(error, "anki_fields");
    }
  }
);

// 6. anki_discover — Auto-probe which Anki markers are valid
server.tool(
  "anki_discover",
  `Auto-detect which Anki field markers are valid in the user's Yomitan configuration.
Call this tool BEFORE using 'anki_fields' to discover which markers the user has configured.
This probes each known marker against Yomitan's ankiFields API with a test word and reports which ones succeed.`,
  {},
  async () => {
    log("info", "Executing anki_discover");
    const testWord = "食べる";
    const valid = [];
    const invalid = [];
    const errors = [];

    for (const marker of KNOWN_MARKERS) {
      try {
        const response = await client.getAnkiFields(testWord, "term", [marker], 1, false);
        if (response?.fields?.length > 0) {
          const value = response.fields[0][marker];
          valid.push({ marker, sample: value ?? "" });
        } else {
          invalid.push(marker);
        }
      } catch {
        invalid.push(marker);
      }
    }

    const result = {
      valid_markers: valid,
      invalid_markers: invalid,
      note: "Use only the markers listed in 'valid_markers' when calling 'anki_fields'. " +
        "If critical markers are missing, ask your human (user) to open Yomitan Settings → Anki → 'Configure Anki card format...' " +
        "and screenshot ALL the Field/Value mappings in the popup window (scroll to the bottom). " +
        "The Value column shows the available {markers}."
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result) }]
    };
  }
);

// 5. status (renamed from yomitan_status)
server.tool(
  "status",
  "Yomitan APIの接続状態とバージョンを確認する",
  {},
  async () => {
    log("info", "Executing status check");
    try {
      const version = await client.getVersion();
      return {
        content: [
          { type: "text", text: `Yomitan connection successful!\nServer backend version: ${version?.version || 'unknown'}` }
        ]
      };
    } catch (error) {
      return handleApiError(error, "status");
    }
  }
);

// --- Server Lifecycle ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "Yomitan MCP Server running on stdio");

  // Graceful Shutdown
  const cleanup = async () => {
    log("info", "Shutting down Yomitan MCP Server...");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((error) => {
  log("fatal", "Fatal error in main()", { error: error.message, stack: error.stack });
  process.exit(1);
});
