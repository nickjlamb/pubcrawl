import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getEuropePmcFullText } from "../lib/europepmc.js";

const schema = {
  source: z
    .string()
    .describe("Europe PMC source, e.g. PPR (preprint), PMC, MED, PAT. Use the `source` field returned by search_europepmc."),
  id: z
    .string()
    .describe("Europe PMC article id — the `id` field from search_europepmc (e.g. a preprint's PPR id, or a PMCID)."),
  sections: z
    .array(z.string())
    .optional()
    .describe("Filter to specific section titles (e.g. [\"methods\", \"results\"])."),
};

export function registerGetEuropePmcFullTextTool(server: McpServer): void {
  server.tool(
    "get_europepmc_fulltext",
    "Get the full text of a preprint or open-access article from Europe PMC, by source + id (as returned by search_europepmc). Returns parsed sections, figure/table captions, and reference count. Complements get_full_text (PMC-only) by covering preprints (bioRxiv, medRxiv) and Europe PMC's wider open-access corpus.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        const result = await getEuropePmcFullText(params.source, params.id, params.sections);

        if (result.sections.length === 0 && result.figure_captions.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                ...result,
                note: "No full-text body was returned — the record may be metadata-only. Try get_abstract for the abstract.",
              }, null, 2),
            }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("NO_FULL_TEXT")) {
          return {
            content: [{
              type: "text",
              text: `No open full text available for ${params.source}/${params.id}. Europe PMC serves full text for open-access articles and many preprints; this record isn't one. Use get_abstract for the abstract, or check is_open_access / has_full_text from search_europepmc.`,
            }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Error fetching Europe PMC full text: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
