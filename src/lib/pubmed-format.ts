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
export function formatSummaryArticle(
  uid: string,
  doc: Record<string, unknown>
): PubMedArticle {
  const authors = parseSummaryAuthors(doc.authors);
  const pubDate = String(doc.pubdate ?? "");
  const year = pubDate.match(/\d{4}/)?.[0] ?? "";
  const doi = String(doc.elocationid ?? "").replace(/^doi:\s*/i, "");

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
