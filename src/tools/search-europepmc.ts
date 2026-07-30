import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchEuropePmc } from "../lib/europepmc.js";

const schema = {
  query: z.string().describe("Search query (Europe PMC query syntax supported, e.g. field tags like AUTH, TITLE, JOURNAL)"),
  maxResults: z.number().min(1).max(100).default(10).describe("Maximum number of results"),
  sort: z.enum(["relevance", "date", "cited"]).default("relevance").describe("Sort order: relevance, date (newest first), or cited (most cited first)"),
  preprintsOnly: z.boolean().default(false).describe("Restrict to preprints (bioRxiv, medRxiv, etc.)"),
  openAccessOnly: z.boolean().default(false).describe("Restrict to open-access articles"),
};

export function registerSearchEuropePmcTool(server: McpServer): void {
  server.tool(
    "search_europepmc",
    "Search Europe PMC — a broader biomedical corpus than PubMed that also indexes preprints (bioRxiv, medRxiv), patents, and agricultural/biomedical databases. Unlike search_pubmed, each result includes an abstract snippet, citation count, open-access status, and whether a preprint. Use preprintsOnly to surface work ahead of formal publication.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        const { results, total_count } = await searchEuropePmc(params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ results, total_count }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error searching Europe PMC: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
