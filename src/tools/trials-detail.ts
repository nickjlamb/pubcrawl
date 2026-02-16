import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTrialDetail } from "../lib/clinicaltrials.js";

const schema = {
  nctId: z
    .string()
    .regex(/^NCT\d{8}$/, "Must be a valid NCT ID (e.g., NCT12345678)")
    .describe("ClinicalTrials.gov NCT identifier (e.g., NCT03086486)"),
};

export function registerTrialDetailTool(server: McpServer): void {
  server.tool(
    "get_trial",
    "Get detailed information about a specific clinical trial from ClinicalTrials.gov. Returns eligibility criteria, study design, arms, outcomes, locations, and associated PubMed IDs.",
    schema,
    async (params) => {
      try {
        const detail = await getTrialDetail(params.nctId);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(detail, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("404")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify(
                { error: `Clinical trial ${params.nctId} not found. Verify the NCT ID is correct.` },
                null,
                2
              ),
            }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: `Error fetching trial details: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
