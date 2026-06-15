import { cache, TTL } from "./cache.js";

const BASE_URL = "https://api.fda.gov/drug/label.json";
const REQUEST_DELAY_MS = 300;
const TIMEOUT_MS = 15000;

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
      throw new Error(`OpenFDA API error: ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export interface OpenFdaDrug {
  generic_name: string;
  brand_name: string;
  manufacturer: string;
  set_id: string;
}

interface OpenFdaResult {
  openfda?: {
    generic_name?: string[];
    brand_name?: string[];
    manufacturer_name?: string[];
    spl_set_id?: string[];
  };
}

interface OpenFdaResponse {
  results?: OpenFdaResult[];
}

// OpenFDA max per request (unauthenticated)
const MAX_PER_PAGE = 99;
const MAX_PAGES = 3;

export async function searchByIndication(
  condition: string,
  limit = 20
): Promise<OpenFdaDrug[]> {
  const cacheKey = `openfda:indication:${condition.toLowerCase()}:${limit}`;
  const cached = cache.get<OpenFdaDrug[]>(cacheKey);
  if (cached) return cached;

  // Use AND of individual terms so "rheumatoid arthritis" matches labels
  // that say "moderately to severely active rheumatoid arthritis" etc.
  const terms = condition.trim().split(/\s+/);
  const query = terms
    .map((t) => `indications_and_usage:${encodeURIComponent(t)}`)
    .join("+AND+");

  const seen = new Map<string, OpenFdaDrug>();

  // Always fetch all pages to maximise drug diversity, then trim.
  // Page 1 is mostly NSAIDs; biologics appear on later pages.
  for (let page = 0; page < MAX_PAGES; page++) {
    const skip = page * MAX_PER_PAGE;
    const url = `${BASE_URL}?search=${query}&limit=${MAX_PER_PAGE}&skip=${skip}`;

    let data: OpenFdaResponse;
    try {
      const response = await rateLimitedFetch(url);
      data = await response.json();
    } catch {
      break;
    }

    if (!data.results || data.results.length === 0) break;

    for (const result of data.results) {
      const openfda = result.openfda;
      if (!openfda) continue;

      const genericName = openfda.generic_name?.[0] ?? "";
      if (!genericName) continue;

      // Skip multi-ingredient kits/combos (e.g. "methylprednisolone acetate,
      // lidocaine hydrochloride, bupivacaine hydrochloride") — these fill
      // slots that should go to distinct therapeutic agents
      if (genericName.includes(",")) continue;

      const key = genericName.toLowerCase();
      if (seen.has(key)) continue;

      seen.set(key, {
        generic_name: genericName,
        brand_name: openfda.brand_name?.[0] ?? "",
        manufacturer: openfda.manufacturer_name?.[0] ?? "",
        set_id: openfda.spl_set_id?.[0] ?? "",
      });
    }
  }

  const drugs = [...seen.values()].slice(0, limit);
  cache.set(cacheKey, drugs, TTL.SEARCH);
  return drugs;
}
