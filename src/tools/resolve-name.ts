import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveName, type ResolveResult } from "@pharmatools/drug-data";
import { cache, TTL } from "../lib/cache.js";

const schema = {
  drug: z
    .string()
    .describe("Brand or generic drug name to resolve (e.g., 'Lipitor' or 'atorvastatin')"),
};

/**
 * Resolve a drug name deterministically via the shared engine (RxNorm, openFDA
 * fallback). Cached for 1h. Returns { error } when the name isn't recognised.
 */
export async function buildResolveResult(
  drug: string
): Promise<ResolveResult | { error: string }> {
  const cacheKey = `resolve:${drug.toLowerCase().trim()}`;
  const cached = cache.get<ResolveResult>(cacheKey);
  if (cached) return cached;

  const result = await resolveName(drug);
  if (!result) {
    return { error: `Could not resolve "${drug}" in RxNorm or openFDA` };
  }
  cache.set(cacheKey, result, TTL.SEARCH);
  return result;
}

export function registerResolveNameTool(server: McpServer): void {
  server.tool(
    "resolve_drug_name",
    "Convert a brand drug name to its generic name (or a generic to its US brand names), with drug class and common indications. Deterministic — sourced from RxNorm/openFDA, no AI.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        const result = await buildResolveResult(params.drug);
        const isError = "error" in result;
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          ...(isError ? { isError: true } : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error resolving drug name: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
