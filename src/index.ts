#!/usr/bin/env node
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configureFromEnv, createPubCrawlServer } from "./server.js";

configureFromEnv();
const server = createPubCrawlServer();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PubCrawl MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
