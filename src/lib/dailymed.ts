import { cache, TTL } from "./cache.js";

const BASE_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2";
const REQUEST_DELAY_MS = 200;
const TIMEOUT_MS = 20000;

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS - elapsed));
  }

  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`DailyMed API error: ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export interface DailyMedSearchResult {
  setid: string;
  title: string;
  published_date: string;
  spl_version: string;
}

export async function searchDrugLabels(drugName: string): Promise<DailyMedSearchResult[]> {
  const cacheKey = `dailymed:search:${drugName.toLowerCase()}`;
  const cached = cache.get<DailyMedSearchResult[]>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    drug_name: drugName,
    pagesize: "10",
  });

  const url = `${BASE_URL}/spls.json?${params}`;
  const response = await rateLimitedFetch(url);
  const data = await response.json();

  const results: DailyMedSearchResult[] = (data.data ?? []).map(
    (item: Record<string, unknown>) => ({
      setid: String(item.setid ?? ""),
      title: String(item.title ?? ""),
      published_date: String(item.published_date ?? ""),
      spl_version: String(item.spl_version ?? ""),
    })
  );

  cache.set(cacheKey, results, TTL.SEARCH);
  return results;
}

export async function searchByIndication(
  indication: string,
  pagesize = 10
): Promise<DailyMedSearchResult[]> {
  const cacheKey = `dailymed:indication:${indication.toLowerCase()}`;
  const cached = cache.get<DailyMedSearchResult[]>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    indication: indication,
    pagesize: String(pagesize),
  });

  const url = `${BASE_URL}/spls.json?${params}`;
  const response = await rateLimitedFetch(url);
  const data = await response.json();

  const results: DailyMedSearchResult[] = (data.data ?? []).map(
    (item: Record<string, unknown>) => ({
      setid: String(item.setid ?? ""),
      title: String(item.title ?? ""),
      published_date: String(item.published_date ?? ""),
      spl_version: String(item.spl_version ?? ""),
    })
  );

  cache.set(cacheKey, results, TTL.SEARCH);
  return results;
}

export async function fetchSplXml(setid: string): Promise<string> {
  const cacheKey = `dailymed:spl:${setid}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/spls/${setid}.xml`;
  const response = await rateLimitedFetch(url);
  const text = await response.text();

  cache.set(cacheKey, text, TTL.LABEL);
  return text;
}
