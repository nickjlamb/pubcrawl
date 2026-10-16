import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUsLabel } from "@pharmatools/drug-data";
import { cache, TTL } from "../lib/cache.js";
import { markTruncated } from "../lib/label-mapping.js";
import {
  pageSections,
  DEFAULT_SECTION_CHARS,
  MIN_SECTION_CHARS,
  MAX_SECTION_CHARS,
} from "../lib/paging.js";
import { USPIResult } from "../types.js";

const schema = {
  drug: z.string().describe("Drug name to look up (e.g., 'metformin', 'atorvastatin')"),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      "Specific sections to retrieve (e.g., ['indications', 'adverse reactions', 'contraindications']). Returns all sections if omitted."
    ),
  max_chars: z
    // coerce: some MCP clients send numbers as strings ("12000")
    .coerce.number()
    .int()
    .min(MIN_SECTION_CHARS)
    .max(MAX_SECTION_CHARS)
    .optional()
    .describe(
      `Maximum characters returned per section (default ${DEFAULT_SECTION_CHARS}). Long sections are returned a page at a time: a cut page has truncated: true, total_chars and next_offset.`
    ),
  offset: z
    // coerce: some MCP clients send numbers as strings ("12000")
    .coerce.number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Character offset to start each section from (default 0). To read the rest of a truncated section, call again with sections set to that one section and offset set to its next_offset."
    ),
};
/**
 * Build a USPIResult from the shared drug-data engine (openFDA, cited to
 * DailyMed). Result-shape compatible with the previous SPL-based implementation.
 * Cached for 24h. Returns { error } when no label is found.
 */
export async function buildUspiResult(
  drug: string,
  sections?: string[],
  paging: { offset?: number; maxChars?: number } = {}
): Promise<USPIResult | { error: string }> {
  const cacheKey = `uspi-full:${drug.toLowerCase()}:${(sections ?? []).join(",").toLowerCase()}`;
  const cached = cache.get<USPIResult>(cacheKey);
  if (cached) return applyPaging(cached, paging);

  const label = await getUsLabel(drug, sections, { maxChars: Infinity });
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
  return applyPaging(result, paging);
}

/** Page every section of a full (cached) result. */
function applyPaging(result: USPIResult, paging: { offset?: number; maxChars?: number }): USPIResult {
  return {
    ...result,
    sections: pageSections(result.sections, paging.offset ?? 0, paging.maxChars ?? DEFAULT_SECTION_CHARS),
  };
}

export function registerUspiTool(server: McpServer): void {
  server.tool(
    "get_uspi",
    "Get FDA US Prescribing Information (USPI) for a drug from openFDA (cited to DailyMed). Returns structured labelling sections with LOINC codes, verbatim. Long sections are paged: a cut section has truncated: true, total_chars and next_offset — call again with that section and offset to read on. Check drug_name: the best openFDA match may be a different product from the one you meant.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        const result = await buildUspiResult(params.drug, params.sections, {
          offset: params.offset,
          maxChars: params.max_chars,
        });
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
