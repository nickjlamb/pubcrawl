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
