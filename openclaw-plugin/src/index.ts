// PubCrawl OpenClaw plugin — biomedical literature, clinical trials, and
// US/UK drug labelling tools. Built by PharmaTools.AI.
//
// This entry reuses the MCP server's data layer (src/lib/*) verbatim and
// exposes it as native OpenClaw agent tools via defineToolPlugin.

import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import { setApiKey, esearch, esummary, efetch, elink, pmidToPmcid } from "./lib/ncbi.js";
import { searchTrials, getTrialDetail } from "./lib/clinicaltrials.js";
import { searchDrugLabels, fetchSplXml } from "./lib/dailymed.js";
import { searchEmc, fetchSmpcHtml, parseSmpcSections, EmcSearchResult } from "./lib/emc.js";
import { searchByIndication } from "./lib/openfda.js";
import { filterSectionMap } from "./lib/label-mapping.js";
import {
  parseXml,
  parseAuthors,
  parseSummaryAuthors,
  parseAbstractSections,
  parseMeshTerms,
  parseKeywords,
  parseJatsSections,
  parseFigureCaptions,
  parseTableCaptions,
  countReferences,
  parseSplSections,
  extractText,
} from "./lib/xml-parser.js";
import {
  PubMedArticle,
  FullAbstract,
  FullTextResult,
  RelatedArticle,
  LabelSection,
  USPIResult,
  SmPCResult,
  LabelComparison,
  CompareLabelsResult,
  DrugApprovalEntry,
  IndicationSearchResult,
} from "./types.js";
import { ArticleInfo, citationFormatters } from "./citations.js";

// --- Static reference data (inlined from the original tool files) ----------

const HIGH_IMPACT_JOURNALS = [
  "nature", "science", "cell", "the new england journal of medicine",
  "the lancet", "jama", "bmj", "nature medicine", "nature biotechnology",
  "nature genetics", "nature reviews", "annals of internal medicine",
  "plos medicine", "circulation", "journal of clinical oncology",
];

const LOINC_MAP: Record<string, string> = {
  "boxed warning": "34071-1",
  "indications": "34067-9",
  "indications and usage": "34067-9",
  "dosage": "34068-7",
  "dosage and administration": "34068-7",
  "dosage forms": "43678-2",
  "contraindications": "34070-3",
  "warnings": "43685-7",
  "warnings and precautions": "43685-7",
  "adverse reactions": "34084-4",
  "drug interactions": "34073-7",
  "use in specific populations": "42228-7",
  "pregnancy": "42228-7",
  "overdosage": "34088-5",
  "clinical pharmacology": "34090-1",
  "description": "34089-3",
  "how supplied": "34069-5",
  "storage": "44425-7",
  "patient counseling": "34076-0",
  "medication guide": "42231-1",
};
const ALL_PI_CODES = [...new Set(Object.values(LOINC_MAP))];

function resolveLoincCodes(sections?: string[]): string[] | undefined {
  if (!sections || sections.length === 0) return undefined;
  const codes: string[] = [];
  for (const input of sections) {
    const lower = input.toLowerCase().trim();
    if (/^\d{5}-\d$/.test(lower)) {
      codes.push(lower);
      continue;
    }
    const match = Object.entries(LOINC_MAP).find(
      ([name]) => name.includes(lower) || lower.includes(name)
    );
    if (match) codes.push(match[1]);
  }
  return codes.length > 0 ? codes : undefined;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function summaryToArticle(uid: string, doc: Record<string, unknown>): PubMedArticle {
  const pubDate = String(doc.pubdate ?? "");
  return {
    pmid: uid,
    title: String(doc.title ?? ""),
    authors: parseSummaryAuthors(doc.authors),
    journal: String(doc.fulljournalname ?? doc.source ?? ""),
    year: pubDate.match(/\d{4}/)?.[0] ?? "",
    doi: (doc.elocationid ?? "").toString().replace(/^doi:\s*/i, ""),
    abstract_snippet: String(doc.sorttitle ?? "").slice(0, 200),
  };
}

function applyApiKey(config: { ncbiApiKey?: string }): void {
  if (config.ncbiApiKey) setApiKey(config.ncbiApiKey);
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Plugin definition ------------------------------------------------------

export default defineToolPlugin({
  id: "pubcrawl",
  name: "PubCrawl",
  description:
    "Biomedical research tools: PubMed literature search, ClinicalTrials.gov, and US (FDA) / UK (eMC) drug labelling. Built by PharmaTools.AI.",
  configSchema: Type.Object({
    ncbiApiKey: Type.Optional(
      Type.String({
        description:
          "Optional NCBI E-utilities API key. Raises the PubMed rate limit from 3 to 10 requests/second.",
      })
    ),
  }),
  tools: (tool) => [
    tool({
      name: "search_pubmed",
      label: "Search PubMed",
      description:
        "Search PubMed for biomedical literature. Returns article summaries with PMIDs, titles, authors, journals, and DOIs.",
      parameters: Type.Object({
        query: Type.String({ description: "PubMed search query" }),
        maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10, description: "Maximum number of results" })),
        sort: Type.Optional(Type.Union([Type.Literal("relevance"), Type.Literal("date")], { default: "relevance", description: "Sort order" })),
        dateFrom: Type.Optional(Type.String({ description: "Start date (YYYY/MM/DD)" })),
        dateTo: Type.Optional(Type.String({ description: "End date (YYYY/MM/DD)" })),
        articleType: Type.Optional(Type.String({ description: "Article type filter (e.g., review, clinical trial)" })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          let term = params.query;
          if (params.articleType) term += ` AND ${params.articleType}[pt]`;
          const searchResult = await esearch({
            term,
            retmax: params.maxResults ?? 10,
            sort: params.sort === "date" ? "pub_date" : "relevance",
            datetype: params.dateFrom || params.dateTo ? "pdat" : undefined,
            mindate: params.dateFrom,
            maxdate: params.dateTo,
          });
          if (searchResult.idlist.length === 0) return { results: [], total_count: 0 };
          const summaryData = await esummary({ id: searchResult.idlist });
          const results: PubMedArticle[] = searchResult.idlist
            .filter((uid) => summaryData[uid])
            .map((uid) => summaryToArticle(uid, summaryData[uid] as Record<string, unknown>));
          return { results, total_count: searchResult.count };
        } catch (error) {
          return { error: `Error searching PubMed: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "get_abstract",
      label: "Get Abstract",
      description:
        "Get the full structured abstract and metadata for a PubMed article. Returns abstract sections (background, methods, results, conclusions), keywords, MeSH terms, and PMC ID.",
      parameters: Type.Object({
        pmid: Type.String({ description: "PubMed ID" }),
        structured: Type.Optional(Type.Boolean({ default: true, description: "Return structured abstract sections" })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          const structured = params.structured ?? true;
          const xml = await efetch({ id: params.pmid, rettype: "xml" });
          const parsed = parseXml(xml);
          const articles = parsed.PubmedArticleSet?.PubmedArticle;
          if (!articles || (Array.isArray(articles) && articles.length === 0)) {
            return { error: `No article found for PMID ${params.pmid}` };
          }
          const article = Array.isArray(articles) ? articles[0] : articles;
          const medlineCitation = article.MedlineCitation;
          const articleData = medlineCitation?.Article;
          const pubmedData = article.PubmedData;
          if (!articleData) return { error: `No article data found for PMID ${params.pmid}` };

          const authors = parseAuthors(articleData.AuthorList);
          const journal = articleData.Journal;
          const journalTitle = extractText(journal?.Title);
          const journalIssue = journal?.JournalIssue;
          const volume = journalIssue?.Volume ? String(journalIssue.Volume) : "";
          const issue = journalIssue?.Issue ? String(journalIssue.Issue) : "";
          const year = journalIssue?.PubDate?.Year
            ? String(journalIssue.PubDate.Year)
            : extractText(journalIssue?.PubDate?.MedlineDate).match(/\d{4}/)?.[0] ?? "";
          const pages = articleData.Pagination?.MedlinePgn ? String(articleData.Pagination.MedlinePgn) : "";

          const abstractSections = parseAbstractSections(articleData.Abstract);
          let finalSections = abstractSections;
          if (!structured && abstractSections.length > 0) {
            finalSections = [{ label: "", text: abstractSections.map((s) => s.text).join(" ") }];
          }

          let doi = "";
          const elocationIds = articleData.ELocationID;
          if (elocationIds) {
            const ids = Array.isArray(elocationIds) ? elocationIds : [elocationIds];
            for (const eid of ids) {
              if (typeof eid === "object" && eid["@_EIdType"] === "doi") { doi = extractText(eid); break; }
            }
          }
          let pmcId = "";
          const articleIdList = pubmedData?.ArticleIdList?.ArticleId;
          if (articleIdList) {
            const ids = Array.isArray(articleIdList) ? articleIdList : [articleIdList];
            for (const id of ids) {
              if (typeof id === "object" && id["@_IdType"] === "pmc") { pmcId = extractText(id); break; }
            }
          }

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
            keywords: parseKeywords(medlineCitation?.KeywordList),
            mesh_terms: parseMeshTerms(medlineCitation?.MeshHeadingList),
            pmc_id: pmcId,
          };
          return result;
        } catch (error) {
          return { error: `Error fetching abstract: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "get_full_text",
      label: "Get Full Text",
      description:
        "Get the full text of an open-access article from PubMed Central. Returns article sections, figure/table captions, and reference count. Only works for articles available in PMC.",
      parameters: Type.Object({
        pmid: Type.Optional(Type.String({ description: "PubMed ID" })),
        pmcid: Type.Optional(Type.String({ description: "PubMed Central ID (e.g., PMC1234567)" })),
        sections: Type.Optional(Type.Array(Type.String(), { description: "Filter to specific section titles" })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          if (!params.pmid && !params.pmcid) return { error: "Either pmid or pmcid is required" };
          let pmcid = params.pmcid ?? null;
          const pmid = params.pmid ?? "";
          if (!pmcid && pmid) {
            pmcid = await pmidToPmcid(pmid);
            if (!pmcid) return { error: `No PMC full text available for PMID ${pmid}. The article may not be open access.` };
          }
          const pmcIdNum = pmcid!.replace(/^PMC/i, "");
          const xml = await efetch({ db: "pmc", id: pmcIdNum, rettype: "xml" });
          const parsed = parseXml(xml);
          const pmcArticle = parsed["pmc-articleset"]?.article ?? parsed.article;
          if (!pmcArticle) return { error: `Could not parse full text for ${pmcid}` };

          const front = pmcArticle.front;
          const body = pmcArticle.body;
          const back = pmcArticle.back;
          const articleMeta = front?.["article-meta"];
          const title = articleMeta?.["title-group"]?.["article-title"]
            ? extractText(articleMeta["title-group"]["article-title"]) : "";

          let sections = parseJatsSections(body);
          if (params.sections && params.sections.length > 0) {
            const requested = params.sections.map((s) => s.toLowerCase());
            sections = sections.filter((s) => requested.some((r) => s.title.toLowerCase().includes(r)));
          }

          const result: FullTextResult = {
            pmid,
            pmcid: pmcid!,
            title,
            sections,
            figure_captions: parseFigureCaptions(body),
            table_captions: parseTableCaptions(body),
            reference_count: countReferences(back),
          };
          return result;
        } catch (error) {
          return { error: `Error fetching full text: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "find_related",
      label: "Find Related Articles",
      description:
        "Find related articles for a given PubMed article. Returns similar papers ranked by relevance score using PubMed's neighbor algorithm.",
      parameters: Type.Object({
        pmid: Type.String({ description: "PubMed ID to find related articles for" }),
        maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10, description: "Maximum number of results" })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          const linkResult = await elink({ id: params.pmid, cmd: "neighbor_score", linkname: "pubmed_pubmed" });
          if (linkResult.links.length === 0) return { results: [], message: "No related articles found" };
          const topLinks = linkResult.links.slice(0, params.maxResults ?? 10);
          const ids = topLinks.map((l) => l.id);
          const scoreMap = new Map(topLinks.map((l) => [l.id, l.score ?? 0]));
          const summaryData = await esummary({ id: ids });
          const results: RelatedArticle[] = ids
            .filter((uid) => summaryData[uid])
            .map((uid) => ({
              ...summaryToArticle(uid, summaryData[uid] as Record<string, unknown>),
              relevance_score: scoreMap.get(uid) ?? 0,
            }));
          return { results };
        } catch (error) {
          return { error: `Error finding related articles: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "format_citation",
      label: "Format Citation",
      description: "Format a citation for a PubMed article in APA, Vancouver, Harvard, or BibTeX style.",
      parameters: Type.Object({
        pmid: Type.String({ description: "PubMed ID" }),
        style: Type.Optional(Type.Union([
          Type.Literal("apa"), Type.Literal("vancouver"), Type.Literal("harvard"), Type.Literal("bibtex"),
        ], { default: "apa", description: "Citation style" })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          const style = params.style ?? "apa";
          const xml = await efetch({ id: params.pmid, rettype: "xml" });
          const parsed = parseXml(xml);
          const articles = parsed.PubmedArticleSet?.PubmedArticle;
          if (!articles || (Array.isArray(articles) && articles.length === 0)) {
            return { error: `No article found for PMID ${params.pmid}` };
          }
          const article = Array.isArray(articles) ? articles[0] : articles;
          const articleData = article.MedlineCitation?.Article;
          if (!articleData) return { error: `No article data for PMID ${params.pmid}` };

          const journal = articleData.Journal;
          const journalIssue = journal?.JournalIssue;
          let doi = "";
          const elocationIds = articleData.ELocationID;
          if (elocationIds) {
            const ids = Array.isArray(elocationIds) ? elocationIds : [elocationIds];
            for (const eid of ids) {
              if (typeof eid === "object" && eid["@_EIdType"] === "doi") { doi = extractText(eid); break; }
            }
          }
          const info: ArticleInfo = {
            authors: parseAuthors(articleData.AuthorList),
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
          return { pmid: params.pmid, style, citation: citationFormatters[style](info) };
        } catch (error) {
          return { error: `Error formatting citation: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "trending_papers",
      label: "Trending Papers",
      description: "Find recent/trending papers on a topic. Sorted by date, with optional filtering to high-impact journals.",
      parameters: Type.Object({
        topic: Type.String({ description: "Topic or search term" }),
        days: Type.Optional(Type.Integer({ minimum: 1, maximum: 365, default: 30, description: "Number of days to look back" })),
        maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20, description: "Maximum number of results" })),
        highImpactOnly: Type.Optional(Type.Boolean({ default: false, description: "Filter to high-impact journals only" })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          const days = params.days ?? 30;
          const now = new Date();
          const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
          let term = params.topic;
          if (params.highImpactOnly) {
            term += ` AND (${HIGH_IMPACT_JOURNALS.map((j) => `"${j}"[journal]`).join(" OR ")})`;
          }
          const searchResult = await esearch({
            term,
            retmax: params.maxResults ?? 20,
            sort: "pub_date",
            datetype: "pdat",
            mindate: formatDate(from),
            maxdate: formatDate(now),
          });
          if (searchResult.idlist.length === 0) {
            return { results: [], total_count: 0, topic: params.topic, period_days: days };
          }
          const summaryData = await esummary({ id: searchResult.idlist });
          const results: PubMedArticle[] = searchResult.idlist
            .filter((uid) => summaryData[uid])
            .map((uid) => summaryToArticle(uid, summaryData[uid] as Record<string, unknown>));
          return { results, total_count: searchResult.count, topic: params.topic, period_days: days };
        } catch (error) {
          return { error: `Error finding trending papers: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "get_uspi",
      label: "Get US Prescribing Info",
      description:
        "Get FDA US Prescribing Information (USPI) for a drug from DailyMed. Returns structured labelling sections with LOINC codes.",
      parameters: Type.Object({
        drug: Type.String({ description: "Drug name to look up (e.g., 'metformin', 'atorvastatin')" }),
        sections: Type.Optional(Type.Array(Type.String(), {
          description: "Specific sections to retrieve (e.g., ['indications', 'adverse reactions']). Returns all sections if omitted.",
        })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          const searchResults = await searchDrugLabels(params.drug);
          if (searchResults.length === 0) return { error: `No FDA labelling found for "${params.drug}"` };
          const drugLower = params.drug.toLowerCase();
          const sorted = [...searchResults].sort((a, b) => {
            const aMatch = a.title.toLowerCase().includes(drugLower) ? 1 : 0;
            const bMatch = b.title.toLowerCase().includes(drugLower) ? 1 : 0;
            if (aMatch !== bMatch) return bMatch - aMatch;
            return b.published_date.localeCompare(a.published_date);
          });
          const best = sorted[0];
          const xml = await fetchSplXml(best.setid);
          const parsed = parseXml(xml);
          const docComponent = parsed?.document?.component;
          const firstComponent = Array.isArray(docComponent) ? docComponent[0] : docComponent;
          const structuredBody = firstComponent?.structuredBody;
          const requestedCodes = resolveLoincCodes(params.sections);
          const rawSections = parseSplSections(structuredBody, requestedCodes);
          const sections: LabelSection[] = rawSections.length > 0
            ? rawSections.map((s) => ({ code: s.code, title: s.title, content: s.content }))
            : parseSplSections(structuredBody, ALL_PI_CODES).map((s) => ({ code: s.code, title: s.title, content: s.content }));
          const result: USPIResult = {
            drug_name: best.title,
            setid: best.setid,
            spl_version: best.spl_version,
            published_date: best.published_date,
            sections,
            dailymed_url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${best.setid}`,
          };
          return result;
        } catch (error) {
          return { error: `Error fetching USPI: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "get_smpc",
      label: "Get UK/EU SmPC",
      description:
        "Get UK/EU Summary of Product Characteristics (SmPC) for a drug from eMC (medicines.org.uk). Returns structured labelling sections.",
      parameters: Type.Object({
        drug: Type.String({ description: "Drug name to look up (e.g., 'metformin', 'atorvastatin')" }),
        sections: Type.Optional(Type.Array(Type.String(), {
          description: "Specific sections to retrieve — accepts numbers like '4.1' or names like 'indications'. Returns all sections if omitted.",
        })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          const searchResults = await searchEmc(params.drug);
          if (searchResults.length === 0) return { error: `No SmPC found for "${params.drug}" on eMC` };
          const drugLower = params.drug.toLowerCase();
          const sorted = [...searchResults].sort((a, b) => {
            const aMatch = a.name.toLowerCase().includes(drugLower) ? 1 : 0;
            const bMatch = b.name.toLowerCase().includes(drugLower) ? 1 : 0;
            return bMatch - aMatch;
          });
          const best = sorted[0];
          const html = await fetchSmpcHtml(best.product_id);
          const sections = parseSmpcSections(html, params.sections);
          const result: SmPCResult = {
            drug_name: best.name,
            product_id: best.product_id,
            sections: sections.map((s) => ({ code: s.code, title: s.title, content: s.content })),
            url: `https://www.medicines.org.uk/emc/product/${best.product_id}/smpc`,
          };
          return result;
        } catch (error) {
          return { error: `Error fetching SmPC: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "compare_labels",
      label: "Compare US/UK Labels",
      description:
        "Compare US FDA Prescribing Information vs UK/EU SmPC for a drug side-by-side. Maps equivalent sections (e.g., US Indications ↔ UK 4.1) and returns paired content.",
      parameters: Type.Object({
        drug: Type.String({ description: "Drug name to compare across US and UK labelling" }),
        sections: Type.Optional(Type.Array(Type.String(), {
          description: "Specific topics to compare (e.g., ['indications', 'adverse reactions']). Compares all mapped sections if omitted.",
        })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          const mappings = filterSectionMap(params.sections);
          if (mappings.length === 0) return { error: "No matching section mappings found for the requested topics" };
          const loincCodes = mappings.map((m) => m.us_loinc);
          const ukCodes = mappings.map((m) => m.uk_code);

          const fetchUs = async () => {
            const searchResults = await searchDrugLabels(params.drug);
            if (searchResults.length === 0) return { sections: new Map<string, LabelSection>(), source: null as string | null };
            const drugLower = params.drug.toLowerCase();
            const sorted = [...searchResults].sort((a, b) => {
              const aMatch = a.title.toLowerCase().includes(drugLower) ? 1 : 0;
              const bMatch = b.title.toLowerCase().includes(drugLower) ? 1 : 0;
              if (aMatch !== bMatch) return bMatch - aMatch;
              return b.published_date.localeCompare(a.published_date);
            });
            const best = sorted[0];
            const xml = await fetchSplXml(best.setid);
            const parsed = parseXml(xml);
            const docComponent = parsed?.document?.component;
            const firstComponent = Array.isArray(docComponent) ? docComponent[0] : docComponent;
            const rawSections = parseSplSections(firstComponent?.structuredBody, loincCodes);
            const sectionMap = new Map<string, LabelSection>();
            for (const s of rawSections) sectionMap.set(s.code, { code: s.code, title: s.title, content: s.content });
            return { sections: sectionMap, source: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${best.setid}` as string | null };
          };

          const fetchUk = async () => {
            const searchResults = await searchEmc(params.drug);
            if (searchResults.length === 0) return { sections: new Map<string, LabelSection>(), source: null as string | null };
            const drugLower = params.drug.toLowerCase();
            const sorted = [...searchResults].sort((a, b) => {
              const aMatch = a.name.toLowerCase().includes(drugLower) ? 1 : 0;
              const bMatch = b.name.toLowerCase().includes(drugLower) ? 1 : 0;
              return bMatch - aMatch;
            });
            const best = sorted[0];
            const html = await fetchSmpcHtml(best.product_id);
            const rawSections = parseSmpcSections(html, ukCodes);
            const sectionMap = new Map<string, LabelSection>();
            for (const s of rawSections) sectionMap.set(s.code, { code: s.code, title: s.title, content: s.content });
            return { sections: sectionMap, source: `https://www.medicines.org.uk/emc/product/${best.product_id}/smpc` as string | null };
          };

          const [usResult, ukResult] = await Promise.allSettled([fetchUs(), fetchUk()]);
          const us = usResult.status === "fulfilled" ? usResult.value : { sections: new Map<string, LabelSection>(), source: null };
          const uk = ukResult.status === "fulfilled" ? ukResult.value : { sections: new Map<string, LabelSection>(), source: null };

          if (us.sections.size === 0 && uk.sections.size === 0) {
            const errors: string[] = [];
            if (usResult.status === "rejected") errors.push(`US: ${usResult.reason}`);
            if (ukResult.status === "rejected") errors.push(`UK: ${ukResult.reason}`);
            return {
              error: `No labelling found for "${params.drug}" in either US or UK databases`,
              details: errors.length > 0 ? errors : undefined,
            };
          }

          const comparisons: LabelComparison[] = mappings.map((mapping) => ({
            topic: mapping.topic,
            us_section: us.sections.get(mapping.us_loinc) ?? null,
            uk_section: uk.sections.get(mapping.uk_code) ?? null,
          }));
          const result: CompareLabelsResult = {
            drug: params.drug,
            comparisons,
            us_source: us.source,
            uk_source: uk.source,
          };
          return result;
        } catch (error) {
          return { error: `Error comparing labels: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "search_by_indication",
      label: "Search by Indication",
      description:
        "Find drugs approved for a medical condition. Searches US FDA labelling for the condition, then checks UK (eMC) availability for each drug found.",
      parameters: Type.Object({
        condition: Type.String({ description: "Medical condition or indication (e.g., 'type 2 diabetes', 'hypertension')" }),
        maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10, description: "Maximum number of drug results to return" })),
      }),
      async execute(params, config) {
        applyApiKey(config);
        try {
          const maxResults = params.maxResults ?? 10;
          const fdaDrugs = await searchByIndication(params.condition, maxResults);
          if (fdaDrugs.length === 0) return { error: `No drugs found for "${params.condition}" in FDA labelling` };

          const MAX_CONCURRENT = 5;
          const genericNames = fdaDrugs.map((d) => d.generic_name);
          const emcResults = new Map<string, EmcSearchResult[]>();
          for (let i = 0; i < genericNames.length; i += MAX_CONCURRENT) {
            const batch = genericNames.slice(i, i + MAX_CONCURRENT);
            const settled = await Promise.allSettled(batch.map((name) => searchEmc(name)));
            settled.forEach((outcome, j) => {
              if (outcome.status === "fulfilled" && outcome.value.length > 0) emcResults.set(batch[j], outcome.value);
            });
          }

          const drugs: DrugApprovalEntry[] = fdaDrugs.map((fda) => {
            const emcMatches = emcResults.get(fda.generic_name);
            return {
              name: fda.generic_name.toLowerCase(),
              brand_name: fda.brand_name,
              manufacturer: fda.manufacturer,
              us_approved: true,
              uk_approved: emcMatches !== undefined,
              us_setid: fda.set_id || undefined,
              uk_product_id: emcMatches?.[0]?.product_id,
            };
          });
          const result: IndicationSearchResult = { condition: params.condition, drugs: drugs.slice(0, maxResults) };
          return result;
        } catch (error) {
          return { error: `Error searching by indication: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "search_trials",
      label: "Search Clinical Trials",
      description:
        "Search ClinicalTrials.gov for clinical trials. Filter by condition, intervention, status, and phase. Returns trial summaries with NCT IDs, status, sponsors, and enrollment info.",
      parameters: Type.Object({
        condition: Type.Optional(Type.String({ description: "Disease or condition (e.g., 'breast cancer', 'diabetes')" })),
        intervention: Type.Optional(Type.String({ description: "Drug or therapy (e.g., 'pembrolizumab', 'radiation')" })),
        term: Type.Optional(Type.String({ description: "General search term (searches all fields)" })),
        status: Type.Optional(Type.Union([
          Type.Literal("RECRUITING"), Type.Literal("COMPLETED"), Type.Literal("ACTIVE_NOT_RECRUITING"),
          Type.Literal("NOT_YET_RECRUITING"), Type.Literal("TERMINATED"), Type.Literal("WITHDRAWN"), Type.Literal("SUSPENDED"),
        ], { description: "Trial recruitment status filter" })),
        phase: Type.Optional(Type.Union([
          Type.Literal("EARLY_PHASE1"), Type.Literal("PHASE1"), Type.Literal("PHASE2"),
          Type.Literal("PHASE3"), Type.Literal("PHASE4"), Type.Literal("NA"),
        ], { description: "Trial phase filter" })),
        maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10, description: "Maximum number of results (1-100)" })),
        sort: Type.Optional(Type.Union([
          Type.Literal("relevance"), Type.Literal("last_updated"), Type.Literal("start_date"), Type.Literal("enrollment"),
        ], { default: "relevance", description: "Sort order for results" })),
      }),
      async execute(params) {
        try {
          if (!params.condition && !params.intervention && !params.term) {
            return { error: "At least one of condition, intervention, or term is required" };
          }
          return await searchTrials({
            condition: params.condition,
            intervention: params.intervention,
            term: params.term,
            status: params.status,
            phase: params.phase,
            maxResults: params.maxResults ?? 10,
            sort: params.sort ?? "relevance",
          });
        } catch (error) {
          return { error: `Error searching ClinicalTrials.gov: ${errMessage(error)}` };
        }
      },
    }),

    tool({
      name: "get_trial",
      label: "Get Clinical Trial",
      description:
        "Get detailed information about a specific clinical trial from ClinicalTrials.gov. Returns eligibility criteria, study design, arms, outcomes, locations, and associated PubMed IDs.",
      parameters: Type.Object({
        nctId: Type.String({
          pattern: "^NCT\\d{8}$",
          description: "ClinicalTrials.gov NCT identifier (e.g., NCT03086486)",
        }),
      }),
      async execute(params) {
        try {
          return await getTrialDetail(params.nctId);
        } catch (error) {
          const message = errMessage(error);
          if (message.includes("404")) {
            return { error: `Clinical trial ${params.nctId} not found. Verify the NCT ID is correct.` };
          }
          return { error: `Error fetching trial details: ${message}` };
        }
      },
    }),
  ],
});
