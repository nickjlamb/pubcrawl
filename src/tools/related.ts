import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { elink, esummary } from "../lib/ncbi.js";
import { parseSummaryAuthors } from "../lib/xml-parser.js";
import { RelatedArticle } from "../types.js";

const schema = {
  pmid: z.string().describe("PubMed ID to find related articles for"),
  maxResults: z.number().min(1).max(100).default(10).describe("Maximum number of results"),
};

export function registerRelatedTool(server: McpServer): void {
  server.tool(
    "find_related",
    "Find related articles for a given PubMed article. Returns similar papers ranked by relevance score using PubMed's neighbor algorithm.",
    schema,
    async (params) => {
      try {
        const linkResult = await elink({
          id: params.pmid,
          cmd: "neighbor_score",
          linkname: "pubmed_pubmed",
        });

        if (linkResult.links.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ results: [], message: "No related articles found" }, null, 2) }],
          };
        }

        // Take top N results
        const topLinks = linkResult.links.slice(0, params.maxResults);
        const ids = topLinks.map((l) => l.id);
        const scoreMap = new Map(topLinks.map((l) => [l.id, l.score ?? 0]));

        const summaryData = await esummary({ id: ids });

        const articles: RelatedArticle[] = ids
          .filter((uid) => summaryData[uid])
          .map((uid) => {
            const doc = summaryData[uid] as Record<string, unknown>;
            const authors = parseSummaryAuthors(doc.authors);
            const pubDate = String(doc.pubdate ?? "");
            const year = pubDate.match(/\d{4}/)?.[0] ?? "";
            const doi = (doc.elocationid ?? "")
              .toString()
              .replace(/^doi:\s*/i, "");

            return {
              pmid: uid,
              title: String(doc.title ?? ""),
              authors,
              journal: String(doc.fulljournalname ?? doc.source ?? ""),
              year,
              doi,
              abstract_snippet: String(doc.sorttitle ?? "").slice(0, 200),
              relevance_score: scoreMap.get(uid) ?? 0,
            };
          });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ results: articles }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error finding related articles: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
