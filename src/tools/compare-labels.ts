import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUsLabel, getUkSmpc } from "@pharmatools/drug-data";
import { cache, TTL } from "../lib/cache.js";
import { filterSectionMap } from "../lib/label-mapping.js";
import { LabelComparison, CompareLabelsResult } from "../types.js";

const schema = {
  drug: z.string().describe("Drug name to compare across US and UK labelling"),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      "Specific topics to compare (e.g., ['indications', 'adverse reactions']). Compares all mapped sections if omitted."
    ),
};

/**
 * Build a CompareLabelsResult by fetching both labels from the shared engine and
 * pairing equivalent sections (US LOINC <-> UK section number). Cached for 24h.
 */
export async function buildCompareResult(
  drug: string,
  sections?: string[]
): Promise<CompareLabelsResult | { error: string }> {
  const mappings = filterSectionMap(sections);
  if (mappings.length === 0) {
    return { error: "No matching section mappings found for the requested topics" };
  }

  const cacheKey = `compare:${drug.toLowerCase()}:${(sections ?? []).join(",").toLowerCase()}`;
  const cached = cache.get<CompareLabelsResult>(cacheKey);
  if (cached) return cached;

  const usCodes = mappings.map((m) => m.us_loinc);
  const ukCodes = mappings.map((m) => m.uk_code);

  // Fetch both in parallel — allow partial results
  const [usSettled, ukSettled] = await Promise.allSettled([
    getUsLabel(drug, usCodes),
    getUkSmpc(drug, ukCodes),
  ]);
  const us = usSettled.status === "fulfilled" ? usSettled.value : null;
  const uk = ukSettled.status === "fulfilled" ? ukSettled.value : null;

  if ((!us || us.sections.length === 0) && (!uk || uk.sections.length === 0)) {
    return { error: `No labelling found for "${drug}" in either US or UK databases` };
  }

  const usByCode = new Map((us?.sections ?? []).map((s) => [s.code, s]));
  const ukByCode = new Map((uk?.sections ?? []).map((s) => [s.code, s]));

  const comparisons: LabelComparison[] = mappings.map((m) => ({
    topic: m.topic,
    us_section: usByCode.get(m.us_loinc) ?? null,
    uk_section: ukByCode.get(m.uk_code) ?? null,
  }));

  const result: CompareLabelsResult = {
    drug,
    comparisons,
    us_source: us?.dailymedUrl ?? null,
    uk_source: uk?.url ?? null,
  };
  cache.set(cacheKey, result, TTL.LABEL);
  return result;
}

export function registerCompareLabelsTool(server: McpServer): void {
  server.tool(
    "compare_labels",
    "Compare US FDA Prescribing Information vs UK/EU SmPC for a drug side-by-side. Maps equivalent sections (e.g., US Indications ↔ UK 4.1) and returns paired content.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        const result = await buildCompareResult(params.drug, params.sections);
        const isError = "error" in result;
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          ...(isError ? { isError: true } : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error comparing labels: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
