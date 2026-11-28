import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPubCrawlServer, SERVER_NAME, SERVER_VERSION, type ToolCallInfo } from "./server.js";
import { UsageCounter } from "./lib/usage.js";
import { addressFromRequest } from "./lib/visitors.js";

export interface HttpAppOptions {
  /**
   * Browser origins allowed to call the server. `"*"` allows any origin (the default,
   * matching earlier releases). With a list, requests carrying any other `Origin`
   * header are refused with 403, as the MCP spec recommends against DNS rebinding.
   * Requests with no `Origin` header (server-to-server agents, curl) are unaffected.
   */
  allowedOrigins: "*" | string[];
  /**
   * Where to write the one-line JSON usage records: one for each MCP `initialize`
   * (client name, version, today's running count and today's distinct-visitor counts;
   * see lib/visitors.ts) and one for each tool call
   * (tool name, outcome, duration and today's running counts). Defaults to stdout,
   * which Railway and most container hosts parse as structured logs. Pass `false`
   * to disable both.
   */
  usageLog?: ((line: string) => void) | false;
}

/** Parse `PUBCRAWL_ALLOWED_ORIGINS` (comma-separated). Unset or `*` means any origin. */
export function parseAllowedOrigins(raw: string | undefined): "*" | string[] {
  if (raw === undefined || raw.trim() === "" || raw.trim() === "*") return "*";
  return raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => o.length > 0);
}

const BASE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null }, headers);
}

/**
 * Apply CORS headers for this request. Returns false if the request's Origin is
 * not on the allowlist, in which case the caller must refuse it.
 */
function applyCors(req: IncomingMessage, res: ServerResponse, allowed: "*" | string[]): boolean {
  for (const [key, value] of Object.entries(BASE_CORS_HEADERS)) {
    res.setHeader(key, value);
  }
  if (allowed === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return true;
  }
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    return true;
  }
  return false;
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  onInitialize: ((name: unknown, version: unknown, address: string | null) => void) | undefined,
  onToolCall: ((info: ToolCallInfo) => void) | undefined,
): Promise<void> {
  // Stateless mode: a fresh server and transport per request, with no session to
  // resume, so there is no server-initiated stream (GET) or session to end (DELETE).
  if (req.method !== "POST") {
    jsonRpcError(res, 405, -32000, "Method not allowed.", { Allow: "POST, OPTIONS" });
    return;
  }

  const server = createPubCrawlServer({ onToolCall });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  // Release both when the response finishes or the client disconnects,
  // so long-running hosts don't accumulate servers.
  res.on("close", () => {
    // Only the instance that handled an `initialize` request knows the client.
    const client = server.server.getClientVersion();
    if (client && onInitialize) onInitialize(client.name, client.version, addressFromRequest(req));
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("MCP request failed:", error instanceof Error ? error.message : error);
    if (!res.headersSent) {
      jsonRpcError(res, 500, -32603, "Internal server error");
    }
  }
}

/** Create the PubCrawl HTTP server without starting it. Call `.listen()` on the result. */
export function createHttpApp(options: HttpAppOptions): Server {
  const log = options.usageLog === undefined ? (line: string) => console.log(line) : options.usageLog;
  const usage = new UsageCounter();
  const onInitialize = log
    ? (name: unknown, version: unknown, address: string | null) =>
        log(JSON.stringify(usage.record(name, version, address)))
    : undefined;
  const onToolCall = log
    ? (info: ToolCallInfo) => log(JSON.stringify(usage.recordToolCall(info.tool, info.ok, info.durationMs, info.nothingFound)))
    : undefined;

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (!applyCors(req, res, options.allowedOrigins)) {
      jsonRpcError(res, 403, -32000, "Origin not allowed.");
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, { status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
      return;
    }

    if (url.pathname === "/mcp") {
      void handleMcp(req, res, onInitialize, onToolCall);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });
}
