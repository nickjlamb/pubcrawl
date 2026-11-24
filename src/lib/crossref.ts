/**
 * Crossref and doi.org lookups, used by `check_references` to resolve DOIs and to
 * search for a cited title.
 *
 * Crossref's REST API is free and needs no key; the `mailto` parameter puts
 * requests in its "polite" pool. Crossref only knows DOIs it registered itself, so
 * a DOI it does not have is checked against the doi.org handle service, which
 * knows every registration agency (DataCite for datasets and arXiv, for example).
 *
 * Results are not cached one by one: a reference list can hold hundreds of DOIs
 * and would push everything else out of the shared LRU cache. The tool caches its
 * whole result instead.
 */
import { createUpstreamClient } from "./upstream.js";

const CROSSREF_URL = "https://api.crossref.org";
const DOI_HANDLE_URL = "https://doi.org/api/handles";
const EMAIL = "nick@pharmatools.ai";
const TIMEOUT_MS = 15000;

// Crossref's polite pool allows 10 requests a second and 3 at a time (its
// x-rate-limit-* headers, November 2026). 150 ms spacing stays clear of the first.
const crossrefFetch = createUpstreamClient({
  name: "crossref",
  errorPrefix: "Crossref API error",
  minDelayMs: 150,
  timeoutMs: TIMEOUT_MS,
});

// Searches are limited much harder than DOI lookups (3 a second by the headers,
// and back-to-back searches were refused in practice). They are rare here: only a
// reference whose identifier is wrong is searched for.
const crossrefSearchFetch = createUpstreamClient({
  name: "crossref-search",
  errorPrefix: "Crossref API error",
  minDelayMs: 700,
  timeoutMs: TIMEOUT_MS,
  retries: 3,
  retryBaseMs: 1000,
});

const doiFetch = createUpstreamClient({
  name: "doi.org",
  errorPrefix: "doi.org API error",
  minDelayMs: 100,
  timeoutMs: TIMEOUT_MS,
  retries: 1,
});

/**
 * Crossref allows polite-pool clients 3 requests at a time and answers 429 above
 * that. `check_references` starts every lookup at once, so the
 * requests are queued here and at most MAX_CONCURRENT are in flight.
 */
const MAX_CONCURRENT = 2;
let inFlight = 0;
const queue: Array<() => void> = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) {
    // The finishing task hands its slot straight to the next in line.
    await new Promise<void>((resolve) => queue.push(resolve));
  } else {
    inFlight += 1;
  }
  try {
    return await task();
  } finally {
    const next = queue.shift();
    if (next) next();
    else inFlight -= 1;
  }
}

/** True when an upstream error is a plain 404, i.e. the answer is "no such record". */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /API error: 404\b/.test(error.message);
}

/** DOIs keep slashes as path separators; everything else is percent-encoded. */
export function doiPath(doi: string): string {
  return doi.split("/").map(encodeURIComponent).join("/");
}

/** The Crossref work for a DOI, or null when Crossref has no such DOI. Throws on any other failure. */
export async function getCrossrefWork(doi: string): Promise<Record<string, unknown> | null> {
  const url = `${CROSSREF_URL}/works/${doiPath(doi)}?mailto=${encodeURIComponent(EMAIL)}`;
  try {
    const response = await limited(() => crossrefFetch(url));
    const data = (await response.json()) as { message?: Record<string, unknown> };
    return data.message ?? null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/** Whether a DOI is registered with any agency. Throws when doi.org cannot be asked. */
export async function doiIsRegistered(doi: string): Promise<boolean> {
  try {
    const response = await limited(() => doiFetch(`${DOI_HANDLE_URL}/${doiPath(doi)}?type=URL`));
    const data = (await response.json()) as { responseCode?: number };
    return data.responseCode === 1;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

/** The closest Crossref works for a free-text citation (title, or the whole reference). */
export async function searchCrossref(citation: string, rows = 3): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    "query.bibliographic": citation.slice(0, 400),
    rows: String(rows),
    select: "DOI,title,subtitle,original-title,author,issued,volume,page,article-number",
    mailto: EMAIL,
  });
  const response = await limited(() => crossrefSearchFetch(`${CROSSREF_URL}/works?${params}`));
  const data = (await response.json()) as { message?: { items?: Record<string, unknown>[] } };
  return data.message?.items ?? [];
}
