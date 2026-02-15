import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { efetch, pmidToPmcid } from "../lib/ncbi.js";
import {
  parseXml,
  parseJatsSections,
  parseFigureCaptions,
  parseTableCaptions,
  countReferences,
  extractText,
} from "../lib/xml-parser.js";
import { FullTextResult } from "../types.js";

const schema = {
  pmid: z.string().optional().describe("PubMed ID"),
  pmcid: z.string().optional().describe("PubMed Central ID (e.g., PMC1234567)"),
  sections: z.array(z.string()).optional().describe("Filter to specific section titles"),
};

export function registerFullTextTool(server: McpServer): void {
  server.tool(
    "get_full_text",
    "Get the full text of an open-access article from PubMed Central. Returns article sections, figure/table captions, and reference count. Only works for articles available in PMC.",
    schema,
    async (params) => {
      try {
        if (!params.pmid && !params.pmcid) {
          return {
            content: [{ type: "text", text: "Either pmid or pmcid is required" }],
            isError: true,
          };
        }

        let pmcid = params.pmcid ?? null;
        const pmid = params.pmid ?? "";

        // Convert PMID to PMCID if needed
        if (!pmcid && pmid) {
          pmcid = await pmidToPmcid(pmid);
          if (!pmcid) {
            return {
              content: [{
                type: "text",
                text: `No PMC full text available for PMID ${pmid}. The article may not be open access.`,
              }],
              isError: true,
            };
          }
        }

        // Strip PMC prefix for the API call
        const pmcIdNum = pmcid!.replace(/^PMC/i, "");

        const xml = await efetch({
          db: "pmc",
          id: pmcIdNum,
          rettype: "xml",
        });

        const parsed = parseXml(xml);
        const pmcArticle = parsed["pmc-articleset"]?.article ?? parsed.article;

        if (!pmcArticle) {
          return {
            content: [{ type: "text", text: `Could not parse full text for ${pmcid}` }],
            isError: true,
          };
        }

        const front = pmcArticle.front;
        const body = pmcArticle.body;
        const back = pmcArticle.back;

        // Extract title
        const articleMeta = front?.["article-meta"];
        const title = articleMeta?.["title-group"]?.["article-title"]
          ? extractText(articleMeta["title-group"]["article-title"])
          : "";

        // Parse sections
        let sections = parseJatsSections(body);

        // Filter to requested sections
        if (params.sections && params.sections.length > 0) {
          const requested = params.sections.map((s) => s.toLowerCase());
          sections = sections.filter((s) =>
            requested.some((r) => s.title.toLowerCase().includes(r))
          );
        }

        const figureCaptions = parseFigureCaptions(body);
        const tableCaptions = parseTableCaptions(body);
        const referenceCount = countReferences(back);

        const result: FullTextResult = {
          pmid: pmid,
          pmcid: pmcid!,
          title,
          sections,
          figure_captions: figureCaptions,
          table_captions: tableCaptions,
          reference_count: referenceCount,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error fetching full text: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
