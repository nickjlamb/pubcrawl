#!/usr/bin/env node
import "dotenv/config";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { setApiKey } from "./lib/ncbi.js";
import { registerSearchTool } from "./tools/search.js";
import { registerAbstractTool } from "./tools/abstract.js";
import { registerFullTextTool } from "./tools/fulltext.js";
import { registerRelatedTool } from "./tools/related.js";
import { registerCiteTool } from "./tools/cite.js";
import { registerTrendingTool } from "./tools/trending.js";
import { registerUspiTool } from "./tools/uspi.js";
import { registerSmpcTool } from "./tools/smpc.js";
import { registerCompareLabelsTool } from "./tools/compare-labels.js";
import { registerSearchIndicationTool } from "./tools/search-indication.js";
import { registerTrialsSearchTool } from "./tools/trials-search.js";
import { registerTrialDetailTool } from "./tools/trials-detail.js";

// Configure NCBI API key if available (10 req/s vs 3 req/s)
if (process.env.NCBI_API_KEY) {
  setApiKey(process.env.NCBI_API_KEY);
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "pubcrawl",
    version: "2.0.0",
  });

  registerSearchTool(server);
  registerAbstractTool(server);
  registerFullTextTool(server);
  registerRelatedTool(server);
  registerCiteTool(server);
  registerTrendingTool(server);
  registerUspiTool(server);
  registerSmpcTool(server);
  registerCompareLabelsTool(server);
  registerSearchIndicationTool(server);
  registerTrialsSearchTool(server);
  registerTrialDetailTool(server);

  return server;
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Set CORS headers on all responses
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }

  // Health check endpoint
  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "pubcrawl" }));
    return;
  }

  // MCP endpoint — new server + transport per request (stateless mode)
  if (url.pathname === "/mcp") {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  // 404 for everything else
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.error(`PubCrawl MCP server running on http://0.0.0.0:${PORT}/mcp`);
});
