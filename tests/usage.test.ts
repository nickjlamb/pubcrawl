import { describe, expect, it } from "vitest";
import { sanitizeClientField, UsageCounter } from "../src/lib/usage.js";

describe("sanitizeClientField", () => {
  it("keeps ordinary client names", () => {
    expect(sanitizeClientField("claude-ai")).toBe("claude-ai");
    expect(sanitizeClientField("@scope/client.v2")).toBe("@scope/client.v2");
  });

  it("neutralises log-unsafe input and caps length", () => {
    expect(sanitizeClientField("evil\nclient=\"x\"")).toBe("evil_client__x_");
    expect(sanitizeClientField("a".repeat(200))).toHaveLength(64);
  });

  it("falls back to unknown", () => {
    expect(sanitizeClientField(undefined)).toBe("unknown");
    expect(sanitizeClientField(42)).toBe("unknown");
    expect(sanitizeClientField("")).toBe("unknown");
  });
});

describe("UsageCounter", () => {
  it("counts per day and per client, resetting at UTC midnight", () => {
    let now = new Date("2026-11-04T23:59:00Z");
    const counter = new UsageCounter(() => now);
    counter.record("claude-ai", "1");
    counter.record("cursor", "1");
    const third = counter.record("claude-ai", "1");
    expect(third).toMatchObject({ day: "2026-11-04", todayTotal: 3, todayForClient: 2 });

    now = new Date("2026-11-05T00:01:00Z");
    const next = counter.record("claude-ai", "1");
    expect(next).toMatchObject({ day: "2026-11-05", todayTotal: 1, todayForClient: 1 });
    expect(counter.snapshot()).toEqual({ day: "2026-11-05", total: 1, clients: { "claude-ai": 1 } });
  });
});

describe("UsageCounter tool calls", () => {
  it("counts calls and errors per tool, resetting at UTC midnight", () => {
    let now = new Date("2026-11-22T23:59:00Z");
    const counter = new UsageCounter(() => now);
    counter.recordToolCall("search_pubmed", true, 120.4);
    counter.recordToolCall("get_abstract", false, 15_000.6);
    const third = counter.recordToolCall("search_pubmed", false, 3);
    expect(third).toEqual({
      message: "mcp tool_call tool=search_pubmed ok=false",
      level: "info",
      event: "tool_call",
      tool: "search_pubmed",
      ok: false,
      durationMs: 3,
      day: "2026-11-22",
      todayToolCalls: 3,
      todayForTool: 2,
      todayErrorsForTool: 1,
    });
    expect(counter.toolSnapshot()).toEqual({
      day: "2026-11-22",
      total: 3,
      tools: { search_pubmed: { calls: 2, errors: 1 }, get_abstract: { calls: 1, errors: 1 } },
    });

    now = new Date("2026-11-23T00:01:00Z");
    expect(counter.recordToolCall("search_pubmed", true, 1)).toMatchObject({
      day: "2026-11-23",
      todayToolCalls: 1,
      todayForTool: 1,
      todayErrorsForTool: 0,
    });
  });

  it("keeps connection and tool counts separate", () => {
    const counter = new UsageCounter(() => new Date("2026-11-22T12:00:00Z"));
    counter.record("claude-ai", "1");
    counter.recordToolCall("get_trial", true, 10);
    expect(counter.snapshot().total).toBe(1);
    expect(counter.toolSnapshot().total).toBe(1);
  });

  it("rounds durations and never reports a negative one", () => {
    const counter = new UsageCounter(() => new Date("2026-11-22T12:00:00Z"));
    expect(counter.recordToolCall("get_trial", true, 12.5).durationMs).toBe(13);
    expect(counter.recordToolCall("get_trial", true, -4).durationMs).toBe(0);
  });
});
