import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchByIndication } from "../lib/openfda.js";
import { searchEmc, EmcSearchResult } from "../lib/emc.js";
import { DrugApprovalEntry, IndicationSearchResult } from "../types.js";

const MAX_CONCURRENT_EMC = 5;

async function batchEmcLookups(
  drugNames: string[]
): Promise<Map<string, EmcSearchResult[]>> {
  const results = new Map<string, EmcSearchResult[]>();
  // Process in batches to cap concurrency
  for (let i = 0; i < drugNames.length; i += MAX_CONCURRENT_EMC) {
    const batch = drugNames.slice(i, i + MAX_CONCURRENT_EMC);
    const settled = await Promise.allSettled(
      batch.map((name) => searchEmc(name))
    );
    for (let j = 0; j < batch.length; j++) {
      const outcome = settled[j];
      if (outcome.status === "fulfilled" && outcome.value.length > 0) {
        results.set(batch[j], outcome.value);
      }
    }
  }
  return results;
}

const schema = {
  condition: z.string().describe("Medical condition or indication to search for (e.g., 'type 2 diabetes', 'hypertension')"),
  maxResults: z.number().min(1).max(50).default(10).describe("Maximum number of drug results to return"),
};

export function registerSearchIndicationTool(server: McpServer): void {
  server.tool(
    "search_by_indication",
    "Find drugs approved for a medical condition. Searches US FDA labelling for the condition, then checks UK (eMC) availability for each drug found.",
    schema,
    async (params) => {
      try {
        // Step 1: Search OpenFDA for drugs with this indication
        const fdaDrugs = await searchByIndication(
          params.condition,
          params.maxResults
        );

        if (fdaDrugs.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `No drugs found for "${params.condition}" in FDA labelling`,
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Step 2: For each unique generic name, check eMC for UK availability
        const genericNames = fdaDrugs.map((d) => d.generic_name);
        const emcResults = await batchEmcLookups(genericNames);

        // Step 3: Merge into final results
        const drugs: DrugApprovalEntry[] = fdaDrugs.map((fda) => {
          const emcMatches = emcResults.get(fda.generic_name);
          return {
            name: fda.generic_name.toLowerCase(),
            brand_name: fda.brand_name,
            manufacturer: fda.manufacturer,
            us_approved: true,
            uk_approved: emcMatches !== undefined,
            us_setid: fda.set_id || undefined,
            uk_product_id: emcMatches?.[0]?.product_id,
          };
        });

        const result: IndicationSearchResult = {
          condition: params.condition,
          drugs: drugs.slice(0, params.maxResults),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error searching by indication: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
