import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { efetch } from "../lib/ncbi.js";
import { parseXml, parseAuthors, extractText } from "../lib/xml-parser.js";

const schema = {
  pmid: z.string().describe("PubMed ID"),
  style: z.enum(["apa", "vancouver", "harvard", "bibtex"]).default("apa").describe("Citation style"),
};

interface ArticleInfo {
  authors: string[];
  title: string;
  journal: string;
  year: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  pmid: string;
}

function formatApa(info: ArticleInfo): string {
  const authorStr = info.authors.length === 0
    ? ""
    : info.authors.length <= 7
      ? info.authors.map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join(" ");
          return `${last}, ${initials}`;
        }).join(", ")
      : info.authors.slice(0, 6).map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join(" ");
          return `${last}, ${initials}`;
        }).join(", ") + ", ... " + (() => {
          const last = info.authors[info.authors.length - 1];
          const parts = last.split(" ");
          const lastName = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join(" ");
          return `${lastName}, ${initials}`;
        })();

  const yearPart = info.year ? ` (${info.year}).` : ".";
  const titlePart = info.title.endsWith(".") ? ` ${info.title}` : ` ${info.title}.`;
  const journalPart = ` *${info.journal}*`;
  const volPart = info.volume ? `, *${info.volume}*` : "";
  const issuePart = info.issue ? `(${info.issue})` : "";
  const pagesPart = info.pages ? `, ${info.pages}` : "";
  const doiPart = info.doi ? ` https://doi.org/${info.doi}` : "";

  return `${authorStr}${yearPart}${titlePart}${journalPart}${volPart}${issuePart}${pagesPart}.${doiPart}`.trim();
}

function formatVancouver(info: ArticleInfo): string {
  const authorStr = info.authors.length === 0
    ? ""
    : info.authors.length <= 6
      ? info.authors.map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0]).join("");
          return `${last} ${initials}`;
        }).join(", ")
      : info.authors.slice(0, 6).map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0]).join("");
          return `${last} ${initials}`;
        }).join(", ") + ", et al";

  const titlePart = info.title.endsWith(".") ? ` ${info.title}` : ` ${info.title}.`;
  const journalPart = ` ${info.journal}.`;
  const yearPart = info.year ? ` ${info.year}` : "";
  const volPart = info.volume ? `;${info.volume}` : "";
  const issuePart = info.issue ? `(${info.issue})` : "";
  const pagesPart = info.pages ? `:${info.pages}` : "";
  const doiPart = info.doi ? ` doi:${info.doi}` : "";

  return `${authorStr}.${titlePart}${journalPart}${yearPart}${volPart}${issuePart}${pagesPart}.${doiPart}`.trim();
}

function formatHarvard(info: ArticleInfo): string {
  const authorStr = info.authors.length === 0
    ? ""
    : info.authors.length <= 3
      ? info.authors.map((a) => {
          const parts = a.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join("");
          return `${last}, ${initials}`;
        }).join(", ")
      : (() => {
          const first = info.authors[0];
          const parts = first.split(" ");
          const last = parts[0];
          const initials = parts.slice(1).map((p) => p[0] + ".").join("");
          return `${last}, ${initials} et al.`;
        })();

  const yearPart = info.year ? ` ${info.year}.` : ".";
  const titlePart = ` '${info.title}'.`;
  const journalPart = ` *${info.journal}*`;
  const volPart = info.volume ? `, ${info.volume}` : "";
  const issuePart = info.issue ? `(${info.issue})` : "";
  const pagesPart = info.pages ? `, pp. ${info.pages}` : "";
  const doiPart = info.doi ? `. doi:${info.doi}` : "";

  return `${authorStr}${yearPart}${titlePart}${journalPart}${volPart}${issuePart}${pagesPart}${doiPart}`.trim();
}

function formatBibtex(info: ArticleInfo): string {
  const key = info.authors.length > 0
    ? info.authors[0].split(" ")[0].toLowerCase() + info.year
    : `pmid${info.pmid}`;

  const authorStr = info.authors.map((a) => {
    const parts = a.split(" ");
    return `${parts[0]}, ${parts.slice(1).join(" ")}`;
  }).join(" and ");

  const lines = [
    `@article{${key},`,
    `  author  = {${authorStr}},`,
    `  title   = {${info.title}},`,
    `  journal = {${info.journal}},`,
    `  year    = {${info.year}},`,
  ];

  if (info.volume) lines.push(`  volume  = {${info.volume}},`);
  if (info.issue) lines.push(`  number  = {${info.issue}},`);
  if (info.pages) lines.push(`  pages   = {${info.pages}},`);
  if (info.doi) lines.push(`  doi     = {${info.doi}},`);
  lines.push(`  pmid    = {${info.pmid}},`);
  lines.push(`}`);

  return lines.join("\n");
}

export function registerCiteTool(server: McpServer): void {
  server.tool(
    "format_citation",
    "Format a citation for a PubMed article in APA, Vancouver, Harvard, or BibTeX style.",
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

        if (!articleData) {
          return {
            content: [{ type: "text", text: `No article data for PMID ${params.pmid}` }],
            isError: true,
          };
        }

        const authors = parseAuthors(articleData.AuthorList);
        const journal = articleData.Journal;
        const journalIssue = journal?.JournalIssue;

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

        const info: ArticleInfo = {
          authors,
          title: extractText(articleData.ArticleTitle),
          journal: extractText(journal?.Title) || extractText(journal?.ISOAbbreviation),
          year: journalIssue?.PubDate?.Year
            ? String(journalIssue.PubDate.Year)
            : extractText(journalIssue?.PubDate?.MedlineDate).match(/\d{4}/)?.[0] ?? "",
          volume: journalIssue?.Volume ? String(journalIssue.Volume) : "",
          issue: journalIssue?.Issue ? String(journalIssue.Issue) : "",
          pages: articleData.Pagination?.MedlinePgn ? String(articleData.Pagination.MedlinePgn) : "",
          doi,
          pmid: params.pmid,
        };

        const formatters: Record<string, (info: ArticleInfo) => string> = {
          apa: formatApa,
          vancouver: formatVancouver,
          harvard: formatHarvard,
          bibtex: formatBibtex,
        };

        const formatted = formatters[params.style](info);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ pmid: params.pmid, style: params.style, citation: formatted }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error formatting citation: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
