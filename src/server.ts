import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setApiKey } from "./lib/ncbi.js";
import { registerSearchTool } from "./tools/search.js";
import { registerSearchEuropePmcTool } from "./tools/search-europepmc.js";
import { registerAbstractTool } from "./tools/abstract.js";
import { registerFullTextTool } from "./tools/fulltext.js";
import { registerRelatedTool } from "./tools/related.js";
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

/**
 * Build an MCP server with every PubCrawl tool registered.
 * The single place tools are registered: the stdio and HTTP entry points both call this,
 * so the two transports always expose the same tool set.
 */
export function createPubCrawlServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerSearchTool(server);
  registerSearchEuropePmcTool(server);
  registerAbstractTool(server);
  registerFullTextTool(server);
  registerRelatedTool(server);
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
