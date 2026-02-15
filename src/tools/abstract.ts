import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { efetch } from "../lib/ncbi.js";
import {
  parseXml,
  parseAuthors,
  parseAbstractSections,
  parseMeshTerms,
  parseKeywords,
  extractText,
} from "../lib/xml-parser.js";
import { FullAbstract } from "../types.js";

const schema = {
  pmid: z.string().describe("PubMed ID"),
  structured: z.boolean().default(true).describe("Return structured abstract sections"),
};

export function registerAbstractTool(server: McpServer): void {
  server.tool(
    "get_abstract",
    "Get the full structured abstract and metadata for a PubMed article. Returns abstract sections (background, methods, results, conclusions), keywords, MeSH terms, and PMC ID.",
    schema,
    async (params) => {
      try {
        const xml = await efetch({ id: params.pmid, rettype: "xml" });
        const parsed = parseXml(xml);

        const articles = parsed.PubmedArticleSet?.PubmedArticle;
        if (!articles || (Array.isArray(articles) && articles.length === 0)) {
          return {
            content: [{ type: "text", text: `No article found for PMID ${params.pmid}` }],
            isError: true,
          };
        }

        const article = Array.isArray(articles) ? articles[0] : articles;
        const medlineCitation = article.MedlineCitation;
        const articleData = medlineCitation?.Article;
        const pubmedData = article.PubmedData;

        if (!articleData) {
          return {
            content: [{ type: "text", text: `No article data found for PMID ${params.pmid}` }],
            isError: true,
          };
        }

        // Extract authors
        const authors = parseAuthors(articleData.AuthorList);

        // Extract journal info
        const journal = articleData.Journal;
        const journalTitle = extractText(journal?.Title);
        const journalIssue = journal?.JournalIssue;
        const volume = journalIssue?.Volume ? String(journalIssue.Volume) : "";
        const issue = journalIssue?.Issue ? String(journalIssue.Issue) : "";
        const year = journalIssue?.PubDate?.Year
          ? String(journalIssue.PubDate.Year)
          : extractText(journalIssue?.PubDate?.MedlineDate).match(/\d{4}/)?.[0] ?? "";
        const pages = articleData.Pagination?.MedlinePgn
          ? String(articleData.Pagination.MedlinePgn)
          : "";

        // Extract abstract
        const abstractSections = parseAbstractSections(articleData.Abstract);

        // If not structured, join all sections
        let finalSections = abstractSections;
        if (!params.structured && abstractSections.length > 0) {
          const fullText = abstractSections.map((s) => s.text).join(" ");
          finalSections = [{ label: "", text: fullText }];
        }

        // Extract DOI
        let doi = "";
        const elocationIds = articleData.ELocationID;
        if (elocationIds) {
          const ids = Array.isArray(elocationIds) ? elocationIds : [elocationIds];
          for (const eid of ids) {
            if (typeof eid === "object" && eid["@_EIdType"] === "doi") {
              doi = extractText(eid);
              break;
            }
          }
        }

        // Extract PMC ID from article IDs
        let pmcId = "";
        const articleIdList = pubmedData?.ArticleIdList?.ArticleId;
        if (articleIdList) {
          const ids = Array.isArray(articleIdList) ? articleIdList : [articleIdList];
          for (const id of ids) {
            if (typeof id === "object" && id["@_IdType"] === "pmc") {
              pmcId = extractText(id);
              break;
            }
          }
        }

        // Extract MeSH terms and keywords
        const meshTerms = parseMeshTerms(medlineCitation?.MeshHeadingList);
        const keywords = parseKeywords(medlineCitation?.KeywordList);

        const result: FullAbstract = {
          pmid: params.pmid,
          title: extractText(articleData.ArticleTitle),
          authors,
          journal: journalTitle,
          year,
          doi,
          volume,
          issue,
          pages,
          abstract_sections: finalSections,
          keywords,
          mesh_terms: meshTerms,
          pmc_id: pmcId,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error fetching abstract: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
