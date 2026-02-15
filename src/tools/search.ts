import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { esearch, esummary } from "../lib/ncbi.js";
import { parseSummaryAuthors } from "../lib/xml-parser.js";
import { PubMedArticle } from "../types.js";

const schema = {
  query: z.string().describe("PubMed search query"),
  maxResults: z.number().min(1).max(100).default(10).describe("Maximum number of results"),
  sort: z.enum(["relevance", "date"]).default("relevance").describe("Sort order"),
  dateFrom: z.string().optional().describe("Start date (YYYY/MM/DD)"),
  dateTo: z.string().optional().describe("End date (YYYY/MM/DD)"),
  articleType: z.string().optional().describe("Article type filter (e.g., review, clinical trial)"),
};

function formatArticle(uid: string, doc: Record<string, unknown>): PubMedArticle {
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
  };
}

export function registerSearchTool(server: McpServer): void {
  server.tool(
    "search_pubmed",
    "Search PubMed for biomedical literature. Returns article summaries with PMIDs, titles, authors, journals, and DOIs.",
    schema,
    async (params) => {
      try {
        let term = params.query;
        if (params.articleType) {
          term += ` AND ${params.articleType}[pt]`;
        }

        const searchResult = await esearch({
          term,
          retmax: params.maxResults,
          sort: params.sort === "date" ? "pub_date" : "relevance",
          datetype: params.dateFrom || params.dateTo ? "pdat" : undefined,
          mindate: params.dateFrom,
          maxdate: params.dateTo,
        });

        if (searchResult.idlist.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ results: [], total_count: 0 }, null, 2) }],
          };
        }

        const summaryData = await esummary({ id: searchResult.idlist });

        const articles: PubMedArticle[] = searchResult.idlist
          .filter((uid) => summaryData[uid])
          .map((uid) => formatArticle(uid, summaryData[uid] as Record<string, unknown>));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ results: articles, total_count: searchResult.count }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error searching PubMed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
