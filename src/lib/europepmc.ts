import { cache, TTL } from "./cache.js";
import {
  parseXml,
  parseJatsSections,
  parseFigureCaptions,
  parseTableCaptions,
  countReferences,
  extractText,
} from "./xml-parser.js";
import { EuropePmcArticle, EuropePmcFullText } from "../types.js";

const BASE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const EMAIL = "nick@pharmatools.ai";
const REQUEST_DELAY_MS = 200;
const TIMEOUT_MS = 15000;

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS - elapsed));
  }

  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Europe PMC API error: ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

const SORT_MAP: Record<string, string | undefined> = {
  relevance: undefined,
  date: "P_PDATE_D desc",
  cited: "CITED desc",
};

/**
 * Build a EuropePmcArticle from a single Europe PMC `core` result object.
 *
 * Pure and defensive: every field is optional in the API response, so each is
 * guarded. Exported so it can be unit-tested against fixture payloads without
 * a network call.
 */
export function formatEuropePmcResult(
  result: Record<string, unknown>
): EuropePmcArticle {
  const source = String(result.source ?? "");
  const id = String(result.id ?? "");
  const journalInfo = (result.journalInfo ?? {}) as Record<string, unknown>;
  const journal = (journalInfo.journal ?? {}) as Record<string, unknown>;
  const abstractText = String(result.abstractText ?? "");

  return {
    id,
    source,
    pmid: result.pmid ? String(result.pmid) : "",
    pmcid: result.pmcid ? String(result.pmcid) : "",
    doi: result.doi ? String(result.doi) : "",
    title: String(result.title ?? ""),
    authors: String(result.authorString ?? ""),
    journal:
      String(journal.title ?? "") || String(journal.isoabbreviation ?? ""),
    year: String(result.pubYear ?? journalInfo.yearOfPublication ?? ""),
    is_preprint: source === "PPR",
    is_open_access: result.isOpenAccess === "Y",
    cited_by_count:
      result.citedByCount != null ? Number(result.citedByCount) : 0,
    // inEPMC === "Y" means the full text is readable in Europe PMC; a PMCID is a
    // reliable fallback signal that an open full text exists.
    has_full_text: result.inEPMC === "Y" || !!result.pmcid,
    abstract_snippet: abstractText ? abstractText.slice(0, 300) : "",
    url: source && id ? `https://europepmc.org/article/${source}/${id}` : "",
  };
}

export async function searchEuropePmc(params: {
  query: string;
  maxResults?: number;
  sort?: "relevance" | "date" | "cited";
  preprintsOnly?: boolean;
  openAccessOnly?: boolean;
}): Promise<{ results: EuropePmcArticle[]; total_count: number }> {
  const cacheKey = `epmc:search:${JSON.stringify(params)}`;
  const cached = cache.get<{ results: EuropePmcArticle[]; total_count: number }>(cacheKey);
  if (cached) return cached;

  // Compose the query with optional filters.
  let query = params.query;
  if (params.preprintsOnly) query += " AND (SRC:PPR)";
  if (params.openAccessOnly) query += " AND (OPEN_ACCESS:Y)";

  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("resultType", "core");
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", String(params.maxResults ?? 10));
  url.searchParams.set("email", EMAIL);

  const sort = SORT_MAP[params.sort ?? "relevance"];
  if (sort) url.searchParams.set("sort", sort);

  const response = await rateLimitedFetch(url.toString());
  const data = (await response.json()) as Record<string, unknown>;

  const resultList = (data.resultList ?? {}) as Record<string, unknown>;
  const rawResults = (resultList.result ?? []) as Array<Record<string, unknown>>;

  const result = {
    results: rawResults.map(formatEuropePmcResult),
    total_count: data.hitCount != null ? Number(data.hitCount) : 0,
  };

  cache.set(cacheKey, result, TTL.SEARCH);
  return result;
}

/**
 * Parse a Europe PMC JATS `fullTextXML` document into structured full text.
 *
 * Europe PMC returns the same JATS `<article>` (front/body/back) that PubMed
 * Central does, so the existing JATS parsers are reused. Pure and exported for
 * fixture-based unit testing — no network.
 */
export function parseEuropePmcFullText(
  xml: string,
  source: string,
  id: string,
  sectionFilter?: string[]
): EuropePmcFullText {
  const parsed = parseXml(xml);
  const article = parsed?.article ?? parsed?.["pmc-articleset"]?.article ?? {};

  const front = article.front;
  const body = article.body;
  const back = article.back;

  const articleMeta = front?.["article-meta"];
  const titleNode = articleMeta?.["title-group"]?.["article-title"];
  const title = titleNode ? extractText(titleNode) : "";

  let sections = parseJatsSections(body);
  if (sectionFilter && sectionFilter.length > 0) {
    const requested = sectionFilter.map((s) => s.toLowerCase());
    sections = sections.filter((s) =>
      requested.some((r) => s.title.toLowerCase().includes(r))
    );
  }

  return {
    source,
    id,
    title,
    is_preprint: source.toUpperCase() === "PPR",
    sections,
    figure_captions: parseFigureCaptions(body),
    table_captions: parseTableCaptions(body),
    reference_count: countReferences(back),
  };
}

/**
 * Fetch and parse the full text of an article/preprint from Europe PMC.
 * Full text is available for open-access articles and many preprints. Throws a
 * NO_FULL_TEXT-tagged error when the source/id has no open full text (HTTP 404).
 */
export async function getEuropePmcFullText(
  source: string,
  id: string,
  sectionFilter?: string[]
): Promise<EuropePmcFullText> {
  const cacheKey = `epmc:fulltext:${source}:${id}:${(sectionFilter ?? []).join(",")}`;
  const cached = cache.get<EuropePmcFullText>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/${encodeURIComponent(source)}/${encodeURIComponent(id)}/fullTextXML`;
  let response: Response;
  try {
    response = await rateLimitedFetch(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404")) {
      throw new Error(`NO_FULL_TEXT: no open full text for ${source}/${id}`);
    }
    throw err;
  }

  const xml = await response.text();
  const result = parseEuropePmcFullText(xml, source, id, sectionFilter);

  cache.set(cacheKey, result, TTL.FULLTEXT);
  return result;
}
