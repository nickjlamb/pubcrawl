import { CacheEntry } from "../types.js";

const DEFAULT_MAX_ENTRIES = 500;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const TTL = {
  SEARCH: ONE_HOUR_MS,
  ABSTRACT: ONE_DAY_MS,
  FULLTEXT: ONE_DAY_MS,
  RELATED: ONE_HOUR_MS,
  SUMMARY: ONE_HOUR_MS,
  LABEL: ONE_DAY_MS,
  TRIAL: FOUR_HOURS_MS,
} as const;

export class LRUCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private maxEntries: number;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttl: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.maxEntries) {
      // Evict least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { value, timestamp: Date.now(), ttl });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export const cache = new LRUCache();
