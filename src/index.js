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
  version: "1.0.0"
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

// Helper for error handling
const handleApiError = (error, action) => {
  log("error", "Yomitan API Error", { action, error: error.message, stack: error.stack });
  return {
    content: [{ type: "text", text: `Error: ${error.message}` }],
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
  "テキストからAnkiカード用のフィールドデータを生成する",
  {
    text: z.string().describe("検索・生成元テキスト"),
    type: z.enum(["term", "kanji"]).optional().default("term").describe("エントリのタイプ"),
    markers: z.array(z.string()).describe("生成するAnkiフィールドマーカー（例: ['headword', 'reading', 'glossary']）"),
    maxEntries: z.number().optional().default(1).describe("生成する最大エントリ数"),
    includeMedia: z.boolean().optional().default(false).describe("メディア（音声等）を含めるか")
  },
  async ({ text, type, markers, maxEntries, includeMedia }) => {
    log("info", "Executing anki_fields", { textLength: [...text].length, type });
    try {
      const response = await client.getAnkiFields(text, type, markers, maxEntries, includeMedia);
      return {
        content: [{ type: "text", text: JSON.stringify(response ?? null) }]
      };
    } catch (error) {
      return handleApiError(error, "anki_fields");
    }
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
