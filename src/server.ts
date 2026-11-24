import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setApiKey } from "./lib/ncbi.js";
import { registerSearchTool } from "./tools/search.js";
import { registerSearchEuropePmcTool } from "./tools/search-europepmc.js";
import { registerAbstractTool } from "./tools/abstract.js";
import { registerFullTextTool } from "./tools/fulltext.js";
import { registerRelatedTool } from "./tools/related.js";
import { registerCheckReferencesTool } from "./tools/check-references.js";
import { registerCiteTool } from "./tools/cite.js";
import { registerTrendingTool } from "./tools/trending.js";
import { registerUspiTool } from "./tools/uspi.js";
import { registerSmpcTool } from "./tools/smpc.js";
import { registerCompareLabelsTool } from "./tools/compare-labels.js";
import { registerSearchIndicationTool } from "./tools/search-indication.js";
import { registerResolveNameTool } from "./tools/resolve-name.js";
import { registerTrialsSearchTool } from "./tools/trials-search.js";
import { registerTrialDetailTool } from "./tools/trials-detail.js";

// package.json sits one level above both src/ (tests) and dist/ (runtime),
// and npm always ships it, so the reported version can't drift from the release.
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const SERVER_NAME = "pubcrawl";
export const SERVER_VERSION: string = pkg.version;

/** Apply environment configuration shared by every transport. Safe to call more than once. */
export function configureFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  // NCBI API key raises the E-utilities limit from 3 to 10 requests per second.
  if (env.NCBI_API_KEY) {
    setApiKey(env.NCBI_API_KEY);
  }
}

/** Reported once per completed tool call: the tool's name, outcome and duration, nothing else. */
export interface ToolCallInfo {
  tool: string;
  /** False when the tool returned `isError` or threw. */
  ok: boolean;
  durationMs: number;
}

export interface PubCrawlServerOptions {
  /**
   * Called after each tool call finishes. Used by the HTTP server for usage counts.
   * It never receives the call's arguments or result.
   */
  onToolCall?: (info: ToolCallInfo) => void;
}

/**
 * Make every tool registered on `server` after this call report to `onToolCall`.
 * Wraps each handler at registration, so only registered tool names are ever reported
 * and a call rejected before it reaches a handler (unknown tool, invalid arguments)
 * is not counted. The handler's own result or error passes through unchanged.
 */
export function instrumentTools(server: McpServer, onToolCall: (info: ToolCallInfo) => void): void {
  type AnyFn = (...args: unknown[]) => unknown;
  const register = server.tool as unknown as AnyFn;
  (server as unknown as { tool: AnyFn }).tool = (...args: unknown[]) => {
    const name = args[0];
    const handler = args[args.length - 1];
    if (typeof name === "string" && typeof handler === "function") {
      args[args.length - 1] = async (...handlerArgs: unknown[]) => {
        const started = performance.now();
        let ok = false;
        try {
          const result = (await (handler as AnyFn)(...handlerArgs)) as { isError?: boolean } | undefined;
          ok = result?.isError !== true;
          return result;
        } finally {
          try {
            onToolCall({ tool: name, ok, durationMs: performance.now() - started });
          } catch {
            // Counting must never change the outcome of a tool call.
          }
        }
      };
    }
    return Reflect.apply(register, server, args);
  };
}

/**
 * Build an MCP server with every PubCrawl tool registered.
 * The single place tools are registered: the stdio and HTTP entry points both call this,
 * so the two transports always expose the same tool set.
 */
export function createPubCrawlServer(options: PubCrawlServerOptions = {}): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  if (options.onToolCall) instrumentTools(server, options.onToolCall);

  registerSearchTool(server);
  registerSearchEuropePmcTool(server);
  registerAbstractTool(server);
  registerFullTextTool(server);
  registerRelatedTool(server);
  registerCheckReferencesTool(server);
  registerCiteTool(server);
  registerTrendingTool(server);
  registerUspiTool(server);
  registerSmpcTool(server);
  registerCompareLabelsTool(server);
  registerSearchIndicationTool(server);
  registerResolveNameTool(server);
  registerTrialsSearchTool(server);
  registerTrialDetailTool(server);

  return server;
}
