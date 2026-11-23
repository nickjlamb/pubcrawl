import { describe, expect, it, vi } from "vitest";
import { createUpstreamClient, retryAfterMs, type RetryEvent } from "../src/lib/upstream.js";

/** A client on a fake clock: sleeping advances time, nothing really waits. */
function harness(responses: Array<Response | Error | "hang">, extra: Record<string, unknown> = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const retriesSeen: RetryEvent[] = [];
  const calls: Array<{ url: string; at: number; headers: unknown }> = [];
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), at: clock, headers: init?.headers });
    const next = responses.shift();
    if (next === undefined) throw new Error("test: no response queued");
    if (next === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
      });
    }
    if (next instanceof Error) throw next;
    return next;
  });
  const client = createUpstreamClient({
    name: "test",
    errorPrefix: "Test API error",
    minDelayMs: 200,
    timeoutMs: 30,
    fetch: fetchStub as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    random: () => 0,
    onRetry: (event) => retriesSeen.push(event),
    ...extra,
  });
  return { client, calls, sleeps, retriesSeen, fetchStub };
}

const ok = () => new Response("fine", { status: 200 });
const status = (code: number, headers: Record<string, string> = {}) =>
  new Response("x".repeat(1000), { status: code, statusText: "Nope", headers });

describe("retryAfterMs", () => {
  it("reads seconds, HTTP dates and rubbish", () => {
    expect(retryAfterMs(null, 0)).toBeNull();
    expect(retryAfterMs("", 0)).toBeNull();
    expect(retryAfterMs("3", 0)).toBe(3000);
    expect(retryAfterMs("soon", 0)).toBeNull();
    const now = Date.parse("2026-11-23T12:00:00Z");
    expect(retryAfterMs("Mon, 23 Nov 2026 12:00:02 GMT", now)).toBe(2000);
    expect(retryAfterMs("Mon, 23 Nov 2026 11:00:00 GMT", now)).toBe(0);
  });
});

describe("createUpstreamClient", () => {
  it("returns a good response at once, with headers passed through", async () => {
    const h = harness([ok()], { headers: { "User-Agent": "PubCrawl" } });
    const response = await h.client("https://example.test/a");
    expect(await response.text()).toBe("fine");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].headers).toEqual({ "User-Agent": "PubCrawl" });
    expect(h.retriesSeen).toEqual([]);
  });

  it("retries a 503 and succeeds", async () => {
    const h = harness([status(503), ok()]);
    const response = await h.client("https://example.test/a");
    expect(response.ok).toBe(true);
    expect(h.calls).toHaveLength(2);
    expect(h.retriesSeen).toEqual([{ upstream: "test", attempt: 1, reason: 503, waitMs: 500 }]);
  });

  it("cancels the body of a failed response before retrying", async () => {
    const failed = status(502);
    const h = harness([failed, ok()]);
    await h.client("https://example.test/a");
    expect(failed.body?.locked || failed.bodyUsed || failed.body === null).toBe(true);
  });

  it("backs off further each time, then gives up with the attempt count", async () => {
    const h = harness([status(429), status(429), status(429)]);
    await expect(h.client("https://example.test/a")).rejects.toThrow("Test API error: 429 Nope (after 3 attempts)");
    expect(h.calls).toHaveLength(3);
    expect(h.retriesSeen.map((r) => r.waitMs)).toEqual([500, 1000]);
  });

  it("does not retry a 404 or a 400", async () => {
    for (const code of [400, 404]) {
      const h = harness([status(code), ok()]);
      await expect(h.client("https://example.test/a")).rejects.toThrow(`Test API error: ${code} Nope`);
      expect(h.calls).toHaveLength(1);
      expect(h.retriesSeen).toEqual([]);
    }
  });

  it("waits as long as Retry-After asks, up to the cap", async () => {
    const h = harness([status(429, { "Retry-After": "2" }), status(429, { "Retry-After": "600" }), ok()]);
    await h.client("https://example.test/a");
    expect(h.retriesSeen.map((r) => r.waitMs)).toEqual([2000, 5000]);
  });

  it("retries a network error", async () => {
    const h = harness([new TypeError("fetch failed"), ok()]);
    await h.client("https://example.test/a");
    expect(h.retriesSeen[0].reason).toBe("network");
  });

  it("reports a network error that never clears", async () => {
    const h = harness([new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("fetch failed")]);
    await expect(h.client("https://example.test/a")).rejects.toThrow(
      "Test API error: network error (fetch failed) (after 3 attempts)",
    );
  });

  it("retries one timeout and succeeds", async () => {
    const h = harness(["hang", ok()]);
    const response = await h.client("https://example.test/a");
    expect(response.ok).toBe(true);
    expect(h.retriesSeen[0].reason).toBe("timeout");
  });

  it("stops after a second timeout, with a message that says what happened", async () => {
    const h = harness(["hang", "hang", ok()]);
    await expect(h.client("https://example.test/a")).rejects.toThrow(
      "Test API error: no response within 0.03 s (after 2 attempts)",
    );
    expect(h.calls).toHaveLength(2);
  });

  it("can be told not to retry", async () => {
    const h = harness([status(503), ok()], { retries: 0 });
    await expect(h.client("https://example.test/a")).rejects.toThrow("Test API error: 503 Nope");
    expect(h.calls).toHaveLength(1);
  });

  it("spaces out requests that arrive together", async () => {
    // Sleepers wake in time order, as real timers would.
    let clock = 0;
    const sleepers: Array<{ at: number; wake: () => void }> = [];
    const startedAt: number[] = [];
    const client = createUpstreamClient({
      name: "test",
      errorPrefix: "Test API error",
      minDelayMs: 200,
      timeoutMs: 1000,
      now: () => clock,
      sleep: (ms) => new Promise<void>((wake) => sleepers.push({ at: clock + ms, wake })),
      fetch: (async () => {
        startedAt.push(clock);
        return ok();
      }) as unknown as typeof fetch,
    });
    const all = Promise.all([1, 2, 3, 4].map((n) => client(`https://example.test/${n}`)));
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setImmediate(r));
      sleepers.sort((x, y) => x.at - y.at);
      const next = sleepers.shift();
      if (!next) continue;
      clock = next.at;
      next.wake();
    }
    await all;
    expect(startedAt).toEqual([0, 200, 400, 600]);
  });

  it("re-reads a delay given as a function", async () => {
    let delay = 300;
    const h = harness([ok(), ok(), ok()], { minDelayMs: () => delay });
    await h.client("https://example.test/1");
    delay = 100;
    await h.client("https://example.test/2");
    await h.client("https://example.test/3");
    expect(h.calls[1].at - h.calls[0].at).toBe(300);
    expect(h.calls[2].at - h.calls[1].at).toBe(100);
  });

  it("carries on when the retry logger throws", async () => {
    const h = harness([status(500), ok()], {
      onRetry: () => {
        throw new Error("logger broke");
      },
    });
    expect((await h.client("https://example.test/a")).ok).toBe(true);
  });

  it("logs retries to stderr by default, never stdout", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const h = harness([status(503), ok()], { onRetry: undefined });
    await h.client("https://example.test/a?term=secret");
    expect(out).not.toHaveBeenCalled();
    const line = JSON.parse(err.mock.calls[0][0] as string);
    expect(line).toMatchObject({ event: "upstream_retry", upstream: "test", reason: 503, level: "warn" });
    expect(JSON.stringify(line)).not.toContain("secret");
    err.mockRestore();
    out.mockRestore();
  });
});
