import { cache, TTL } from "./cache.js";
import { EuropePmcArticle } from "../types.js";
import { createUpstreamClient } from "./upstream.js";
import { statusFromEuropePmc } from "./publication-status.js";

const BASE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const EMAIL = "nick@pharmatools.ai";
const REQUEST_DELAY_MS = 200;
const TIMEOUT_MS = 15000;

// Spacing, timeout and retry live in upstream.ts.
const rateLimitedFetch = createUpstreamClient({
  name: "europepmc",
  errorPrefix: "Europe PMC API error",
  minDelayMs: REQUEST_DELAY_MS,
  timeoutMs: TIMEOUT_MS,
});

const SORT_MAP: Record<string, string | undefined> = {
  relevance: undefined,
  date: "P_PDATE_D desc",
  cited: "CITED desc",
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * Europe PMC returns abstracts as HTML fragments: structured abstracts wrap each
 * section label in `<h4>`, and inline markup such as `<i>`, `<sub>` and `<sup>` is
 * common. Turn that into plain text, keeping section labels as "Label: ".
 */
export function plainAbstract(html: string): string {
  return html
    .replace(/<h[1-6][^>]*>\s*([\s\S]*?)\s*<\/h[1-6]>/gi, (_match, label: string) => {
      const text = label.replace(/<[^>]*>/g, "").replace(/[:.\s]+$/, "");
      return text ? ` ${text}: ` : " ";
    })
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      const lower = code.toLowerCase();
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
      return ENTITIES[lower] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

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
  // Europe PMC returns a single `authorString` ("Smith J, Doe A, Brown C.").
  // Split into an array so the shape matches search_pubmed's `authors: string[]`
  // — consistency downstream consumers (and PubCrawl's own tools) rely on.
  const authorString = String(result.authorString ?? "").replace(/\.\s*$/, "");
  const authors = authorString
    ? authorString.split(",").map((a) => a.trim()).filter(Boolean)
    : [];
  const status = statusFromEuropePmc(result);

  return {
    id,
    source,
    pmid: result.pmid ? String(result.pmid) : "",
    pmcid: result.pmcid ? String(result.pmcid) : "",
    doi: result.doi ? String(result.doi) : "",
    title: String(result.title ?? ""),
    retracted: status.retracted,
    ...(status.warning !== undefined && { warning: status.warning }),
    ...(status.notices !== undefined && { notices: status.notices }),
    authors,
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
    abstract_snippet: abstractText ? plainAbstract(abstractText).slice(0, 300) : "",
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
