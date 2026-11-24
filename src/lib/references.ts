/**
 * Reference-list integrity: parse a paper's reference list from PMC JATS XML and
 * compare each reference with the record its identifier points to.
 *
 * Everything here is pure (no network), so it is unit-tested against fixtures.
 * The lookups themselves are injected by `src/tools/check-references.ts`.
 *
 * What this can and cannot say. A reference whose identifier resolves to a record
 * with a matching title is `resolved`. One whose identifier is wrong but whose
 * title is found elsewhere is `wrong_identifier`. One that matches nothing is
 * `not_found`, which is NOT proof of fabrication: books, reports, non-English
 * journals and typos fail for innocent reasons. A reference that could not be
 * checked is `not_checked` and is never counted as clean.
 */
import { extractText, findAllElements } from "./xml-parser.js";

/** One entry of a paper's reference list, as the paper cites it. */
export interface ParsedReference {
  /** Position in the reference list, from 1. */
  n: number;
  /** The label printed in the paper ("12", "[12]"), when there is one. */
  label: string;
  pmid: string;
  doi: string;
  /** Article or chapter title, when the XML marks one up. */
  title: string;
  /** Every word of the citation, flattened. Used when no title is marked up. */
  text: string;
  first_author: string;
  year: string;
  source: string;
  volume: string;
  first_page: string;
  /** JATS `publication-type` (journal, book, eref, other ...), when given. */
  type: string;
}

/** A record an identifier or a title search resolved to. */
export interface CandidateRecord {
  via: "pubmed" | "crossref";
  pmid: string;
  doi: string;
  /** The record's title plus any alternative (vernacular or original-language) titles. */
  titles: string[];
  first_author: string;
  year: string;
  volume: string;
  first_page: string;
}

export interface MatchResult {
  match: boolean;
  /** What the match rests on; null when there is no match. */
  on: "title" | "bibliographic" | null;
  /** Best title similarity found, 0 to 1, to two decimals. */
  similarity: number;
}

/** Title similarity at or above this is a match. */
export const TITLE_MATCH_THRESHOLD = 0.7;
/** Share of a record's title words that must appear in an unstructured citation. */
export const TEXT_COVERAGE_THRESHOLD = 0.8;

const CITATION_KEYS = ["element-citation", "mixed-citation", "citation", "nlm-citation"] as const;

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A DOI without resolver prefix, surrounding punctuation or case differences in the prefix. */
export function normaliseDoi(raw: string): string {
  let doi = raw.trim().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  doi = doi.replace(/[\s.,;:)\]>"']+$/, "");
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : "";
}

const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"<>]+/;

/** The citation elements inside one `<ref>`: `citation-alternatives` is unwrapped. */
function citationsOf(ref: Record<string, unknown>): Record<string, unknown>[] {
  const holders: Record<string, unknown>[] = [ref];
  for (const alt of asArray(ref["citation-alternatives"])) {
    if (isRecord(alt)) holders.push(alt);
  }
  const found: Record<string, unknown>[] = [];
  for (const key of CITATION_KEYS) {
    for (const holder of holders) {
      for (const citation of asArray(holder[key])) {
        if (isRecord(citation)) found.push(citation);
        else if (typeof citation === "string") found.push({ "#text": citation });
      }
    }
  }
  return found;
}

function pubIds(citation: Record<string, unknown>): { pmid: string; doi: string } {
  let pmid = "";
  let doi = "";
  for (const id of findAllElements(citation, "pub-id")) {
    if (!isRecord(id)) continue;
    const type = String(id["@_pub-id-type"] ?? "").toLowerCase();
    const value = clean(extractText(id));
    if (type === "pmid" && !pmid && /^\d+$/.test(value)) pmid = value;
    if (type === "doi" && !doi) doi = normaliseDoi(value);
  }
  if (!doi) {
    for (const link of findAllElements(citation, "ext-link")) {
      if (!isRecord(link)) continue;
      const type = String(link["@_ext-link-type"] ?? "").toLowerCase();
      const href = String(link["@_xlink:href"] ?? "");
      if (type === "doi") doi = normaliseDoi(href) || normaliseDoi(extractText(link));
      else if (/doi\.org\//i.test(href)) doi = normaliseDoi(href);
      if (doi) break;
    }
  }
  return { pmid, doi };
}

function firstSurname(citation: Record<string, unknown>): string {
  for (const key of ["name", "string-name"]) {
    for (const name of findAllElements(citation, key)) {
      if (isRecord(name) && name.surname !== undefined) {
        const surname = clean(extractText(name.surname));
        if (surname) return surname;
      }
    }
  }
  const collab = findAllElements(citation, "collab")[0];
  return collab === undefined ? "" : clean(extractText(collab));
}

function field(citation: Record<string, unknown>, key: string): string {
  const value = asArray(citation[key])[0];
  return value === undefined ? "" : clean(extractText(value));
}

function parseCitation(citation: Record<string, unknown>): Omit<ParsedReference, "n" | "label"> {
  const text = clean(extractText(citation));
  const ids = pubIds(citation);
  let doi = ids.doi;
  if (!doi) {
    const inText = text.match(DOI_IN_TEXT);
    if (inText) doi = normaliseDoi(inText[0]);
  }
  const year = field(citation, "year").match(/\d{4}/)?.[0] ?? "";
  return {
    pmid: ids.pmid,
    doi,
    title: field(citation, "article-title") || field(citation, "chapter-title"),
    text,
    first_author: firstSurname(citation),
    year,
    source: field(citation, "source"),
    volume: field(citation, "volume"),
    first_page: field(citation, "fpage") || field(citation, "elocation-id"),
    type: String(citation["@_publication-type"] ?? ""),
  };
}

/**
 * Every reference in a JATS `<back>` element, in list order.
 *
 * A `<ref>` can hold several citation elements (a structured and an unstructured
 * copy, or an original-language and a translated copy). The identifiers, title
 * and other fields are each taken from the first copy that has them.
 */
export function parseJatsReferences(back: unknown): ParsedReference[] {
  if (!back) return [];
  const refs = findAllElements(back, "ref");
  const parsed: ParsedReference[] = [];
  for (const ref of refs) {
    if (!isRecord(ref)) continue;
    const copies = citationsOf(ref).map(parseCitation);
    const merged: ParsedReference = {
      n: parsed.length + 1,
      label: ref.label === undefined ? "" : clean(extractText(ref.label)),
      pmid: "", doi: "", title: "", text: "", first_author: "", year: "",
      source: "", volume: "", first_page: "", type: "",
    };
    for (const copy of copies) {
      for (const key of Object.keys(copy) as Array<keyof typeof copy>) {
        if (!merged[key] && copy[key]) merged[key] = copy[key];
      }
    }
    if (!merged.text) merged.text = clean(extractText(ref));
    parsed.push(merged);
  }
  return parsed;
}

/** Lower-case words of a title, without markup, accents or punctuation. */
export function titleTokens(title: string): string[] {
  const plain = title
    .replace(/<[^>]*>/g, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return plain === "" ? [] : plain.split(" ");
}

/**
 * How alike two titles are, 0 to 1. Word-set overlap (Dice), so word order and
 * punctuation do not matter: inline markup in JATS titles can reorder words.
 * A title wholly contained in the other (a dropped subtitle) counts as a match
 * when it has at least four words.
 */
export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(titleTokens(a));
  const setB = new Set(titleTokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  const dice = (2 * shared) / (setA.size + setB.size);
  const smaller = Math.min(setA.size, setB.size);
  const contained = smaller >= 4 && shared === smaller ? 1 : 0;
  return Math.max(dice, contained);
}

/** Share of the title's words that appear in a block of citation text, 0 to 1. */
export function textCoverage(title: string, text: string): number {
  const wanted = new Set(titleTokens(title));
  if (wanted.size === 0) return 0;
  const have = new Set(titleTokens(text));
  let found = 0;
  for (const token of wanted) if (have.has(token)) found += 1;
  return found / wanted.size;
}

function sameSurname(a: string, b: string): boolean {
  const left = titleTokens(a);
  const right = new Set(titleTokens(b));
  return left.length > 0 && left.some((token) => token.length > 1 && right.has(token));
}

function firstPageOf(pages: string): string {
  return pages.trim().split(/[-–—]/)[0].trim().toLowerCase();
}

/**
 * Does the record an identifier resolved to look like the cited reference?
 *
 * Title first. When the titles differ (most often a translated title: PubMed
 * shows an English translation, the paper cites the original), the reference
 * still matches if year, first author and either volume or first page agree.
 */
export function compareReference(ref: ParsedReference, record: CandidateRecord): MatchResult {
  let similarity = 0;
  for (const title of record.titles) {
    if (!title) continue;
    const score = ref.title
      ? titleSimilarity(ref.title, title)
      : titleTokens(title).length >= 3 ? textCoverage(title, ref.text) : 0;
    if (score > similarity) similarity = score;
  }
  const threshold = ref.title ? TITLE_MATCH_THRESHOLD : TEXT_COVERAGE_THRESHOLD;
  const rounded = Math.round(similarity * 100) / 100;
  if (similarity >= threshold) return { match: true, on: "title", similarity: rounded };

  const yearAgrees = ref.year !== "" && ref.year === record.year;
  const authorAgrees = sameSurname(ref.first_author, record.first_author);
  const volumeAgrees = ref.volume !== "" && ref.volume.toLowerCase() === record.volume.toLowerCase();
  const pageAgrees = ref.first_page !== "" && firstPageOf(ref.first_page) === firstPageOf(record.first_page);
  if (yearAgrees && authorAgrees && (volumeAgrees || pageAgrees)) {
    return { match: true, on: "bibliographic", similarity: rounded };
  }
  return { match: false, on: null, similarity: rounded };
}

/** A PubMed esummary document as a candidate record, or null when PubMed has no such PMID. */
export function recordFromSummary(pmid: string, doc: unknown): CandidateRecord | null {
  if (!isRecord(doc) || doc.error !== undefined) return null;
  const title = String(doc.title ?? "");
  const vernacular = String(doc.vernaculartitle ?? "");
  if (!title && !vernacular) return null;
  const authors = asArray(doc.authors);
  const first = isRecord(authors[0]) ? String(authors[0].name ?? "") : "";
  let doi = "";
  for (const entry of asArray(doc.articleids)) {
    if (isRecord(entry) && entry.idtype === "doi" && typeof entry.value === "string") doi = entry.value.trim();
  }
  return {
    via: "pubmed",
    pmid,
    doi,
    titles: [title, vernacular].filter(Boolean),
    // esummary names are "Surname Initials"; keep the surname part.
    first_author: first.replace(/\s+[A-Z]{1,4}$/, ""),
    year: String(doc.pubdate ?? "").match(/\d{4}/)?.[0] ?? String(doc.epubdate ?? "").match(/\d{4}/)?.[0] ?? "",
    volume: String(doc.volume ?? ""),
    first_page: firstPageOf(String(doc.pages ?? "")),
  };
}

/** A Crossref work (`message` of /works/{doi}, or one item of a search) as a candidate record. */
export function recordFromCrossref(work: unknown): CandidateRecord | null {
  if (!isRecord(work)) return null;
  const titles = [...asArray(work.title), ...asArray(work["original-title"]), ...asArray(work.subtitle)]
    .map((t) => clean(String(t ?? "")))
    .filter(Boolean);
  const doi = typeof work.DOI === "string" ? work.DOI : "";
  if (titles.length === 0 && !doi) return null;
  // A title with its subtitle appended matches citations that include both.
  const main = asArray(work.title)[0];
  const sub = asArray(work.subtitle)[0];
  if (main && sub) titles.push(clean(`${String(main)} ${String(sub)}`));
  const author = asArray(work.author)[0];
  const issued = isRecord(work.issued) ? asArray(work.issued["date-parts"])[0] : undefined;
  const year = asArray(issued)[0];
  return {
    via: "crossref",
    pmid: "",
    doi,
    titles,
    first_author: isRecord(author) ? String(author.family ?? author.name ?? "") : "",
    year: year === undefined || year === null ? "" : String(year),
    volume: String(work.volume ?? ""),
    first_page: firstPageOf(String(work.page ?? work["article-number"] ?? "")),
  };
}

/** One line a reader can recognise the reference by. */
export function citationLine(ref: ParsedReference): string {
  const title = ref.title || ref.text;
  const short = title.length > 160 ? `${title.slice(0, 157)}...` : title;
  const lead = [ref.first_author, ref.year].filter(Boolean).join(" ");
  if (!ref.title) return short;
  return [lead, short, ref.source].filter(Boolean).join(". ");
}
