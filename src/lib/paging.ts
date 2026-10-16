/**
 * Paging for long label sections.
 *
 * The shared engine (@pharmatools/drug-data >= 0.3.0) can return full
 * verbatim sections. Some are long (an SmPC 4.2 or a USPI Dosage and
 * Administration section can run to tens of thousands of characters), so
 * PubCrawl returns them a page at a time. A cut page is flagged `truncated`,
 * and `next_offset` says where the next page starts in the full section text.
 */

/** Default page size for get_smpc / get_uspi. */
export const DEFAULT_SECTION_CHARS = 6000;
/** Default page size per side for compare_labels (two labels per topic). */
export const COMPARE_SECTION_CHARS = 4000;
/** Smallest and largest page a caller may ask for. */
export const MIN_SECTION_CHARS = 500;
export const MAX_SECTION_CHARS = 50000;

export interface PageFields {
  /** True when more of this section follows; content ends with " …". */
  truncated?: boolean;
  /** Length of the full section text, present when paging applies. */
  total_chars?: number;
  /** Where this page starts in the full section (present when > 0). */
  offset?: number;
  /** Pass this as `offset` to get the next page (present when truncated). */
  next_offset?: number;
}

/**
 * Return one page of a section. Pages end on a sentence or line boundary
 * when one falls in the last 40% of the page, otherwise at the page size.
 * A section that already carries `truncated` (cut upstream) keeps the flag.
 */
export function pageSection<T extends { content: string; truncated?: boolean }>(
  section: T,
  offset = 0,
  maxChars = DEFAULT_SECTION_CHARS
): T & PageFields {
  const full = section.content;
  const total = full.length;
  const start = Math.max(0, Math.floor(offset));

  if (start >= total) {
    return start === 0 ? { ...section } : { ...section, content: "", truncated: false, total_chars: total, offset: start };
  }

  const rest = full.slice(start);
  if (rest.length <= maxChars) {
    if (start === 0) return { ...section };
    return { ...section, content: rest.trimStart(), total_chars: total, offset: start };
  }

  const window = rest.slice(0, maxChars);
  const lastStop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
  const cut = lastStop > maxChars * 0.6 ? lastStop + 1 : maxChars;

  return {
    ...section,
    content: rest.slice(0, cut).trim() + " …",
    truncated: true,
    total_chars: total,
    ...(start > 0 ? { offset: start } : {}),
    next_offset: start + cut,
  };
}

export function pageSections<T extends { content: string; truncated?: boolean }>(
  sections: T[],
  offset = 0,
  maxChars = DEFAULT_SECTION_CHARS
): (T & PageFields)[] {
  return sections.map((s) => pageSection(s, offset, maxChars));
}
