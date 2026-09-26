import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUkSmpc } from "@pharmatools/drug-data";
import { cache, TTL } from "../lib/cache.js";
import { markTruncated } from "../lib/label-mapping.js";
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

/**
 * Build an SmPCResult from the shared drug-data engine (eMC). Result-shape
 * compatible with the previous implementation. Cached for 24h.
 */
export async function buildSmpcResult(
  drug: string,
  sections?: string[]
): Promise<SmPCResult | { error: string }> {
  const cacheKey = `smpc:${drug.toLowerCase()}:${(sections ?? []).join(",").toLowerCase()}`;
  const cached = cache.get<SmPCResult>(cacheKey);
  if (cached) return cached;

  const smpc = await getUkSmpc(drug, sections);
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
  return result;
}

export function registerSmpcTool(server: McpServer): void {
  server.tool(
    "get_smpc",
    "Get UK/EU Summary of Product Characteristics (SmPC) for a drug from eMC (medicines.org.uk). Returns structured labelling sections.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        const result = await buildSmpcResult(params.drug, params.sections);
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
