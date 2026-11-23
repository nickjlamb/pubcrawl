import { describe, expect, it } from "vitest";
import { UsageCounter } from "../src/lib/usage.js";
import { addressFromRequest, MAX_VISITORS_PER_DAY, normaliseAddress, VisitorCounter } from "../src/lib/visitors.js";

const request = (headers: Record<string, string | string[]>, remoteAddress?: string) =>
  ({ headers, socket: { remoteAddress } }) as unknown as Parameters<typeof addressFromRequest>[0];

describe("normaliseAddress", () => {
  it("keeps IPv4, unwraps IPv4-mapped IPv6 and reduces IPv6 to its /64", () => {
    expect(normaliseAddress(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(normaliseAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normaliseAddress("2001:0db8:85a3:0001:1111:2222:3333:4444")).toBe("2001:db8:85a3:1::/64");
    expect(normaliseAddress("2001:db8:85a3:1:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:85a3:1::/64");
    expect(normaliseAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normaliseAddress("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(normaliseAddress("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(normaliseAddress("::1")).toBe("0:0:0:0::/64");
  });

  it("rejects anything that is not an address", () => {
    for (const bad of ["", "unknown", "203.0.113", "example.com", "1.2.3.4, 5.6.7.8", "<script>"]) {
      expect(normaliseAddress(bad)).toBeNull();
    }
  });
});

describe("addressFromRequest", () => {
  it("prefers X-Real-IP, then the last X-Forwarded-For entry, then the socket", () => {
    expect(addressFromRequest(request({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "10.0.0.1" }, "127.0.0.1"))).toBe("198.51.100.1");
    expect(addressFromRequest(request({ "x-forwarded-for": "1.1.1.1, 198.51.100.2" }, "127.0.0.1"))).toBe("198.51.100.2");
    expect(addressFromRequest(request({}, "::ffff:192.0.2.9"))).toBe("192.0.2.9");
  });

  it("skips an unusable header and gives null when nothing is usable", () => {
    expect(addressFromRequest(request({ "x-real-ip": "nonsense" }, "192.0.2.9"))).toBe("192.0.2.9");
    expect(addressFromRequest(request({ "x-forwarded-for": "garbage" }))).toBeNull();
  });
});

describe("VisitorCounter", () => {
  it("counts each address once, overall and per group", () => {
    const counter = new VisitorCounter();
    expect(counter.note("203.0.113.1", "cursor")).toEqual({ visitors: 1, visitorsForGroup: 1 });
    expect(counter.note("203.0.113.1", "cursor")).toEqual({ visitors: 1, visitorsForGroup: 1 });
    expect(counter.note("203.0.113.2", "cursor")).toEqual({ visitors: 2, visitorsForGroup: 2 });
    expect(counter.note("203.0.113.1", "claude-code")).toEqual({ visitors: 2, visitorsForGroup: 1 });
  });

  it("does not count a connection with no address", () => {
    const counter = new VisitorCounter();
    counter.note("203.0.113.1", "cursor");
    expect(counter.note(null, "cursor")).toEqual({ visitors: 1, visitorsForGroup: 1 });
    expect(counter.note(null, "other")).toEqual({ visitors: 1, visitorsForGroup: 0 });
  });

  it("forgets everyone and changes key on reset", () => {
    let keys = 0;
    const counter = new VisitorCounter(() => Buffer.alloc(32, ++keys));
    counter.note("203.0.113.1", "cursor");
    counter.reset();
    expect(keys).toBe(2);
    expect(counter.note("203.0.113.2", "cursor")).toEqual({ visitors: 1, visitorsForGroup: 1 });
  });

  it("holds nothing that contains or reveals an address", () => {
    const counter = new VisitorCounter();
    counter.note("203.0.113.77", "cursor");
    const held = JSON.stringify(counter, (_key, value) =>
      value instanceof Set ? [...value] : value instanceof Map ? [...value] : value,
    );
    expect(held).not.toContain("203.0.113.77");
    // The same address under another key gives another identifier.
    const a = new VisitorCounter(() => Buffer.alloc(32, 1));
    const b = new VisitorCounter(() => Buffer.alloc(32, 2));
    a.note("203.0.113.77", "x");
    b.note("203.0.113.77", "x");
    const ids = (c: VisitorCounter) => [...(c as unknown as { all: Set<string> }).all];
    expect(ids(a)[0]).not.toBe(ids(b)[0]);
    expect(ids(a)[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  it("stops remembering new visitors at the cap but keeps counting known ones", () => {
    const counter = new VisitorCounter();
    for (let i = 0; i < MAX_VISITORS_PER_DAY + 10; i++) {
      counter.note(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, "bulk");
    }
    expect(counter.note("10.0.0.1", "bulk").visitors).toBe(MAX_VISITORS_PER_DAY);
    expect(counter.note("192.0.2.200", "bulk").visitors).toBe(MAX_VISITORS_PER_DAY);
  });
});

describe("UsageCounter distinct visitors", () => {
  it("reports distinct visitors on each initialize line and never the address", () => {
    const counter = new UsageCounter(() => new Date("2026-11-23T12:00:00Z"));
    counter.record("cursor", "1.0", "203.0.113.5");
    counter.record("cursor", "1.0", "203.0.113.5");
    const third = counter.record("claude-code", "2.0", "203.0.113.6");
    expect(third).toMatchObject({ todayTotal: 3, todayVisitors: 2, todayForClient: 1, todayVisitorsForClient: 1 });
    expect(JSON.stringify(third)).not.toContain("203.0.113");
    expect(counter.record("cursor", "1.0").todayVisitors).toBe(2);
  });

  it("starts again when the UTC day changes", () => {
    let now = new Date("2026-11-23T23:59:00Z");
    const counter = new UsageCounter(() => now);
    counter.record("cursor", "1.0", "203.0.113.5");
    counter.record("cursor", "1.0", "203.0.113.6");
    now = new Date("2026-11-24T00:01:00Z");
    expect(counter.record("cursor", "1.0", "203.0.113.5")).toMatchObject({ todayTotal: 1, todayVisitors: 1 });
  });
});
