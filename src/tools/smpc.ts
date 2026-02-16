import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchEmc, fetchSmpcHtml, parseSmpcSections } from "../lib/emc.js";
import { SmPCResult } from "../types.js";

const schema = {
  drug: z.string().describe("Drug name to look up (e.g., 'metformin', 'atorvastatin')"),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      "Specific sections to retrieve — accepts numbers like '4.1' or names like 'indications'. Returns all sections if omitted."
    ),
};

export function registerSmpcTool(server: McpServer): void {
  server.tool(
    "get_smpc",
    "Get UK/EU Summary of Product Characteristics (SmPC) for a drug from eMC (medicines.org.uk). Returns structured labelling sections.",
    schema,
    async (params) => {
      try {
        const searchResults = await searchEmc(params.drug);

        if (searchResults.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: `No SmPC found for "${params.drug}" on eMC` }, null, 2),
            }],
            isError: true,
          };
        }

        // Select best match: prefer name containing the drug
        const drugLower = params.drug.toLowerCase();
        const sorted = [...searchResults].sort((a, b) => {
          const aMatch = a.name.toLowerCase().includes(drugLower) ? 1 : 0;
          const bMatch = b.name.toLowerCase().includes(drugLower) ? 1 : 0;
          return bMatch - aMatch;
        });

        const best = sorted[0];
        const html = await fetchSmpcHtml(best.product_id);
        const sections = parseSmpcSections(html, params.sections);

        const result: SmPCResult = {
          drug_name: best.name,
          product_id: best.product_id,
          sections: sections.map((s) => ({ code: s.code, title: s.title, content: s.content })),
          url: `https://www.medicines.org.uk/emc/product/${best.product_id}/smpc`,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error fetching SmPC: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
