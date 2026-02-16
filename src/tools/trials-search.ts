import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchTrials } from "../lib/clinicaltrials.js";

const schema = {
  condition: z.string().optional().describe("Disease or condition (e.g., 'breast cancer', 'diabetes')"),
  intervention: z.string().optional().describe("Drug or therapy (e.g., 'pembrolizumab', 'radiation')"),
  term: z.string().optional().describe("General search term (searches all fields)"),
  status: z
    .enum([
      "RECRUITING",
      "COMPLETED",
      "ACTIVE_NOT_RECRUITING",
      "NOT_YET_RECRUITING",
      "TERMINATED",
      "WITHDRAWN",
      "SUSPENDED",
    ])
    .optional()
    .describe("Trial recruitment status filter"),
  phase: z
    .enum(["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"])
    .optional()
    .describe("Trial phase filter"),
  maxResults: z.number().min(1).max(100).default(10).describe("Maximum number of results (1-100)"),
  sort: z
    .enum(["relevance", "last_updated", "start_date", "enrollment"])
    .default("relevance")
    .describe("Sort order for results"),
};

export function registerTrialsSearchTool(server: McpServer): void {
  server.tool(
    "search_trials",
    "Search ClinicalTrials.gov for clinical trials. Filter by condition, intervention, status, and phase. Returns trial summaries with NCT IDs, status, sponsors, and enrollment info.",
    schema,
    async (params) => {
      try {
        if (!params.condition && !params.intervention && !params.term) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify(
                { error: "At least one of condition, intervention, or term is required" },
                null,
                2
              ),
            }],
            isError: true,
          };
        }

        const result = await searchTrials({
          condition: params.condition,
          intervention: params.intervention,
          term: params.term,
          status: params.status,
          phase: params.phase,
          maxResults: params.maxResults,
          sort: params.sort,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error searching ClinicalTrials.gov: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
