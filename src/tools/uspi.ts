import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUsLabel } from "@pharmatools/drug-data";
import { cache, TTL } from "../lib/cache.js";
import { markTruncated } from "../lib/label-mapping.js";
import { USPIResult } from "../types.js";

const schema = {
  drug: z.string().describe("Drug name to look up (e.g., 'metformin', 'atorvastatin')"),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      "Specific sections to retrieve (e.g., ['indications', 'adverse reactions', 'contraindications']). Returns all sections if omitted."
    ),
};

/**
 * Build a USPIResult from the shared drug-data engine (openFDA, cited to
 * DailyMed). Result-shape compatible with the previous SPL-based implementation.
 * Cached for 24h. Returns { error } when no label is found.
 */
export async function buildUspiResult(
  drug: string,
  sections?: string[]
): Promise<USPIResult | { error: string }> {
  const cacheKey = `uspi:${drug.toLowerCase()}:${(sections ?? []).join(",").toLowerCase()}`;
  const cached = cache.get<USPIResult>(cacheKey);
  if (cached) return cached;

  const label = await getUsLabel(drug, sections);
  if (!label || label.sections.length === 0) {
    return { error: `No FDA labelling found for "${drug}"` };
  }

  const result: USPIResult = {
    drug_name: label.drugName,
    setid: label.setId,
    spl_version: "",
    published_date: label.publishedDate,
    sections: markTruncated(label.sections),
    dailymed_url: label.dailymedUrl,
  };
  cache.set(cacheKey, result, TTL.LABEL);
  return result;
}

export function registerUspiTool(server: McpServer): void {
  server.tool(
    "get_uspi",
    "Get FDA US Prescribing Information (USPI) for a drug from openFDA (cited to DailyMed). Returns structured labelling sections with LOINC codes.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        const result = await buildUspiResult(params.drug, params.sections);
        const isError = "error" in result;
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          ...(isError ? { isError: true } : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error fetching USPI: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
