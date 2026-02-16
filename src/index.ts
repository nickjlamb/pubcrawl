#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const server = new McpServer({
  name: "pubcrawl",
  version: "2.0.0",
});

// Configure NCBI API key if available (10 req/s vs 3 req/s)
if (process.env.NCBI_API_KEY) {
  setApiKey(process.env.NCBI_API_KEY);
}

// Register all tools
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PubCrawl MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
