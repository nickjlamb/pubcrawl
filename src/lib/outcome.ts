/**
 * Tell "the source has nothing for this" apart from "the call failed".
 *
 * A tool that looks something up and finds nothing (no PMC full text for a PMID, no
 * label for a drug name, no trial with that NCT ID) still returns `isError: true`,
 * so the model knows it got no content and can try something else. But in the usage
 * log that is not a failure of PubCrawl or of an upstream, and counting it as one
 * made healthy tools look broken (get_full_text showed 14% "errors" on 2026-11-24,
 * nearly all of them papers that are simply not in PMC).
 *
 * A handler wraps such a result in `nothingFound(...)`. The mark lives in a WeakSet
 * in this process, so the result sent to the client is unchanged.
 */
const marked = new WeakSet<object>();

/** Mark a tool result as "looked, and the source has nothing". Returns the same object. */
export function nothingFound<T extends object>(result: T): T {
  marked.add(result);
  return result;
}

export function isNothingFound(result: unknown): boolean {
  return typeof result === "object" && result !== null && marked.has(result);
}
