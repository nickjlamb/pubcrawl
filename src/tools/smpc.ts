import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUkSmpc } from "@pharmatools/drug-data";
import { cache, TTL } from "../lib/cache.js";
import { markTruncated } from "../lib/label-mapping.js";
import {
  pageSections,
  DEFAULT_SECTION_CHARS,
  MIN_SECTION_CHARS,
  MAX_SECTION_CHARS,
} from "../lib/paging.js";
import { SmPCResult } from "../types.js";

const schema = {
  drug: z.string().describe("Drug name to look up (e.g., 'metformin', 'atorvastatin')"),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      "Specific sections to retrieve — accepts numbers like '4.1' or names like 'indications'. Returns all sections if omitted."
    ),
  max_chars: z
    .number()
    .int()
    .min(MIN_SECTION_CHARS)
    .max(MAX_SECTION_CHARS)
    .optional()
    .describe(
      `Maximum characters returned per section (default ${DEFAULT_SECTION_CHARS}). Long sections are returned a page at a time: a cut page has truncated: true, total_chars and next_offset.`
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Character offset to start each section from (default 0). To read the rest of a truncated section, call again with sections set to that one section and offset set to its next_offset."
    ),
};
/**
 * Build an SmPCResult from the shared drug-data engine (eMC). Result-shape
 * compatible with the previous implementation. Cached for 24h.
 */
export async function buildSmpcResult(
  drug: string,
  sections?: string[],
  paging: { offset?: number; maxChars?: number } = {}
): Promise<SmPCResult | { error: string }> {
  const cacheKey = `smpc-full:${drug.toLowerCase()}:${(sections ?? []).join(",").toLowerCase()}`;
  const cached = cache.get<SmPCResult>(cacheKey);
  if (cached) return applyPaging(cached, paging);

  const smpc = await getUkSmpc(drug, sections, { maxChars: Infinity });
  if (!smpc || smpc.sections.length === 0) {
    return { error: `No SmPC found for "${drug}" on eMC` };
  }

  const result: SmPCResult = {
    drug_name: smpc.drugName,
    product_id: smpc.productId,
    sections: markTruncated(smpc.sections),
    url: smpc.url,
  };
  cache.set(cacheKey, result, TTL.LABEL);
  return applyPaging(result, paging);
}

/** Page every section of a full (cached) result. */
function applyPaging(result: SmPCResult, paging: { offset?: number; maxChars?: number }): SmPCResult {
  return {
    ...result,
    sections: pageSections(result.sections, paging.offset ?? 0, paging.maxChars ?? DEFAULT_SECTION_CHARS),
  };
}

export function registerSmpcTool(server: McpServer): void {
  server.tool(
    "get_smpc",
    "Get UK/EU Summary of Product Characteristics (SmPC) for a drug from eMC (medicines.org.uk). Returns structured labelling sections, verbatim. Long sections are paged: a cut section has truncated: true, total_chars and next_offset — call again with that section and offset to read on. Check drug_name: the best eMC match may be a different product or formulation from the one you meant.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        const result = await buildSmpcResult(params.drug, params.sections, {
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
          content: [{ type: "text", text: `Error fetching SmPC: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
