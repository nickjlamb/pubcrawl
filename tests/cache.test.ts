import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LRUCache, TTL } from "../src/lib/cache.js";

describe("LRUCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves a value", () => {
    const cache = new LRUCache();
    cache.set("a", { n: 1 }, TTL.SEARCH);
    expect(cache.get<{ n: number }>("a")).toEqual({ n: 1 });
  });

  it("returns undefined for a missing key", () => {
    const cache = new LRUCache();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("expires entries after their TTL", () => {
    const cache = new LRUCache();
    cache.set("a", "v", 1000);
    vi.advanceTimersByTime(999);
    expect(cache.get("a")).toBe("v");
    vi.advanceTimersByTime(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0); // expired entry is evicted on read
  });

  it("evicts the least-recently-used entry when full", () => {
    const cache = new LRUCache(2);
    cache.set("a", 1, TTL.SEARCH);
    cache.set("b", 2, TTL.SEARCH);
    cache.get("a"); // touch "a" so "b" is now the LRU
    cache.set("c", 3, TTL.SEARCH); // should evict "b"
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it("overwrites an existing key without growing size", () => {
    const cache = new LRUCache();
    cache.set("a", 1, TTL.SEARCH);
    cache.set("a", 2, TTL.SEARCH);
    expect(cache.get("a")).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("clear() empties the cache", () => {
    const cache = new LRUCache();
    cache.set("a", 1, TTL.SEARCH);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
