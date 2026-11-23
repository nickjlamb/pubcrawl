/**
 * One request path for every upstream API (NCBI, Europe PMC, eMC,
 * ClinicalTrials.gov, openFDA): spacing between requests, a timeout per attempt,
 * and a bounded retry for failures that are usually momentary.
 *
 * Why retry: these are public APIs that rate-limit and occasionally stall. Before
 * this, one 429 or one slow response failed the whole tool call (and, on
 * 2026-11-23, the weekly OpenGATE gate, when Europe PMC took over 15 s once and
 * answered in under a second straight afterwards).
 *
 * What is retried: HTTP 429, 500, 502, 503 and 504, network errors, and
 * timeouts. Anything else (400, 404 and so on) is the caller's answer and is
 * returned as an error at once. A timeout is retried only once, so the worst case
 * stays near two timeouts and well inside an MCP client's patience.
 */
import { discardBody } from "./discard-body.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 5000;

export interface RetryEvent {
  upstream: string;
  /** The attempt that just failed, counting from 1. */
  attempt: number;
  /** An HTTP status code, "timeout" or "network". */
  reason: number | "timeout" | "network";
  /** How long the client will wait before the next attempt. */
  waitMs: number;
}

export interface UpstreamOptions {
  /** Short name for logs, e.g. "europepmc". */
  name: string;
  /** Start of error messages, e.g. "Europe PMC API error". Kept as it was before this module. */
  errorPrefix: string;
  /** Minimum spacing between requests, in ms. A function is re-read on every request. */
  minDelayMs: number | (() => number);
  /** Timeout for each attempt, in ms. */
  timeoutMs: number;
  headers?: Record<string, string>;
  /** Extra attempts after a retryable HTTP status or network error. Default 2. */
  retries?: number;
  /** First backoff, in ms; doubles each retry. Default 500. */
  retryBaseMs?: number;
  /** Called before each retry. Default: one JSON line on stderr. */
  onRetry?: (event: RetryEvent) => void;
  // Seams for tests.
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export type UpstreamFetch = (url: string) => Promise<Response>;

/** `Retry-After` as milliseconds (it is either seconds or an HTTP date), or null. */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (value === "") return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function logRetry(event: RetryEvent): void {
  // stderr, never stdout: stdout is the protocol channel for the stdio transport.
  console.error(
    JSON.stringify({
      message: `upstream retry ${event.upstream} reason=${event.reason}`,
      level: "warn",
      event: "upstream_retry",
      ...event,
    }),
  );
}

export function createUpstreamClient(options: UpstreamOptions): UpstreamFetch {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const retries = options.retries ?? 2;
  const retryBaseMs = options.retryBaseMs ?? 500;
  const onRetry = options.onRetry ?? logRetry;
  const minDelay = () => (typeof options.minDelayMs === "function" ? options.minDelayMs() : options.minDelayMs);

  // Each request reserves the next free slot before waiting for it, so the spacing
  // holds when several tool calls arrive at once (the HTTP server handles requests
  // concurrently). Reading a shared "last request" time after the wait does not.
  let nextSlot = 0;
  async function takeSlot(): Promise<void> {
    const current = now();
    const slot = Math.max(current, nextSlot);
    nextSlot = slot + minDelay();
    if (slot > current) await sleep(slot - current);
  }

  return async function upstreamFetch(url: string): Promise<Response> {
    let timeouts = 0;
    for (let attempt = 1; ; attempt++) {
      await takeSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      let reason: RetryEvent["reason"];
      let failure: Error;
      let serverWaitMs: number | null = null;
      try {
        const response = await doFetch(url, { signal: controller.signal, headers: options.headers });
        if (response.ok) return response;
        serverWaitMs = retryAfterMs(response.headers.get("retry-after"), now());
        await discardBody(response);
        reason = response.status;
        failure = new Error(`${options.errorPrefix}: ${response.status} ${response.statusText}`.trimEnd());
        if (!RETRYABLE_STATUS.has(response.status)) throw failure;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(`${options.errorPrefix}: `)) throw error;
        if (controller.signal.aborted) {
          timeouts += 1;
          reason = "timeout";
          failure = new Error(`${options.errorPrefix}: no response within ${options.timeoutMs / 1000} s`);
        } else {
          reason = "network";
          const detail = error instanceof Error ? error.message : String(error);
          failure = new Error(`${options.errorPrefix}: network error (${detail})`);
        }
      } finally {
        clearTimeout(timer);
      }

      const attemptsLeft = attempt <= retries && !(reason === "timeout" && timeouts > 1);
      if (!attemptsLeft) {
        if (attempt > 1) failure.message += ` (after ${attempt} attempts)`;
        throw failure;
      }
      const backoff = retryBaseMs * 2 ** (attempt - 1) + Math.floor(random() * 250);
      const waitMs = serverWaitMs === null ? backoff : Math.min(Math.max(serverWaitMs, backoff), MAX_RETRY_AFTER_MS);
      try {
        onRetry({ upstream: options.name, attempt, reason, waitMs });
      } catch {
        // Logging must never change the outcome of a request.
      }
      await sleep(waitMs);
    }
  };
}
