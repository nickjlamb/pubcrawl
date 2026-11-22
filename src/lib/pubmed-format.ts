import { parseSummaryAuthors } from "./xml-parser.js";
import { PubMedArticle } from "../types.js";
import { statusFromSummary } from "./publication-status.js";

/**
 * Build a PubMedArticle from a single NCBI esummary document.
 *
 * Shared by search_pubmed, find_related, and trending_papers so the three
 * tools return an identical shape from the same code path.
 *
 * Note: esummary does NOT return abstract text, so no abstract field is
 * populated here. (A previous version put `doc.sorttitle` — a normalised copy
 * of the title — into an `abstract_snippet` field, which duplicated the title
 * under a misleading key. Use get_abstract to retrieve real abstract text.)
 *
 * esummary does report retraction status and correction notices (`pubtype`,
 * `references`), so every result carries `retracted` and, when relevant, a
 * `warning` and the `notices` themselves.
 */
/**
 * The article's DOI from an esummary document.
 *
 * `articleids` is the reliable source: it lists every identifier with its type.
 * `elocationid` is only a fallback, because it is empty for many older records
 * (so the DOI was silently dropped) and can hold a non-DOI identifier such as
 * "pii: S0140..." (which must not be reported as a DOI).
 */
export function doiFromSummary(doc: Record<string, unknown>): string {
  if (Array.isArray(doc.articleids)) {
    for (const entry of doc.articleids) {
      const id = (entry ?? {}) as Record<string, unknown>;
      if (id.idtype === "doi" && typeof id.value === "string" && id.value.trim() !== "") {
        return id.value.trim();
      }
    }
  }
  const match = String(doc.elocationid ?? "").match(/^\s*doi:\s*(\S+)/i);
  return match ? match[1] : "";
}

export function formatSummaryArticle(
  uid: string,
  doc: Record<string, unknown>
): PubMedArticle {
  const authors = parseSummaryAuthors(doc.authors);
  const pubDate = String(doc.pubdate ?? "");
  const year = pubDate.match(/\d{4}/)?.[0] ?? "";
  const doi = doiFromSummary(doc);

  const status = statusFromSummary(doc);

  return {
    pmid: uid,
    title: String(doc.title ?? ""),
    retracted: status.retracted,
    ...(status.warning !== undefined && { warning: status.warning }),
    ...(status.notices !== undefined && { notices: status.notices }),
    authors,
    journal: String(doc.fulljournalname ?? doc.source ?? ""),
    year,
    doi,
  };
}
