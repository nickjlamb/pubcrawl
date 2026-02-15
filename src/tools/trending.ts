import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { esearch, esummary } from "../lib/ncbi.js";
import { parseSummaryAuthors } from "../lib/xml-parser.js";
import { PubMedArticle } from "../types.js";

const HIGH_IMPACT_JOURNALS = [
  "nature",
  "science",
  "cell",
  "the new england journal of medicine",
  "the lancet",
  "jama",
  "bmj",
  "nature medicine",
  "nature biotechnology",
  "nature genetics",
  "nature reviews",
  "annals of internal medicine",
  "plos medicine",
  "circulation",
  "journal of clinical oncology",
];

const schema = {
  topic: z.string().describe("Topic or search term"),
  days: z.number().min(1).max(365).default(30).describe("Number of days to look back"),
  maxResults: z.number().min(1).max(100).default(20).describe("Maximum number of results"),
  highImpactOnly: z.boolean().default(false).describe("Filter to high-impact journals only"),
};

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

export function registerTrendingTool(server: McpServer): void {
  server.tool(
    "trending_papers",
    "Find recent/trending papers on a topic. Sorted by date, with optional filtering to high-impact journals.",
    schema,
    async (params) => {
      try {
        const now = new Date();
        const from = new Date(now.getTime() - params.days * 24 * 60 * 60 * 1000);

        let term = params.topic;
        if (params.highImpactOnly) {
          const journalFilter = HIGH_IMPACT_JOURNALS
            .map((j) => `"${j}"[journal]`)
            .join(" OR ");
          term += ` AND (${journalFilter})`;
        }

        const searchResult = await esearch({
          term,
          retmax: params.maxResults,
          sort: "pub_date",
          datetype: "pdat",
          mindate: formatDate(from),
          maxdate: formatDate(now),
        });

        if (searchResult.idlist.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                results: [],
                total_count: 0,
                topic: params.topic,
                period_days: params.days,
              }, null, 2),
            }],
          };
        }

        const summaryData = await esummary({ id: searchResult.idlist });

        const articles: PubMedArticle[] = searchResult.idlist
          .filter((uid) => summaryData[uid])
          .map((uid) => {
            const doc = summaryData[uid] as Record<string, unknown>;
            const authors = parseSummaryAuthors(doc.authors);
            const pubDate = String(doc.pubdate ?? "");
            const year = pubDate.match(/\d{4}/)?.[0] ?? "";
            const doi = (doc.elocationid ?? "").toString().replace(/^doi:\s*/i, "");

            return {
              pmid: uid,
              title: String(doc.title ?? ""),
              authors,
              journal: String(doc.fulljournalname ?? doc.source ?? ""),
              year,
              doi,
              abstract_snippet: String(doc.sorttitle ?? "").slice(0, 200),
            };
          });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: articles,
              total_count: searchResult.count,
              topic: params.topic,
              period_days: params.days,
            }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error finding trending papers: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
