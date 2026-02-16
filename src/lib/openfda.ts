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

export async function searchByIndication(
  condition: string,
  limit = 20
): Promise<OpenFdaDrug[]> {
  const cacheKey = `openfda:indication:${condition.toLowerCase()}:${limit}`;
  const cached = cache.get<OpenFdaDrug[]>(cacheKey);
  if (cached) return cached;

  const query = encodeURIComponent(`indications_and_usage:"${condition}"`);
  const url = `${BASE_URL}?search=${query}&limit=${limit}`;
  const response = await rateLimitedFetch(url);
  const data: OpenFdaResponse = await response.json();

  if (!data.results) return [];

  // Deduplicate by generic_name (many generics of the same drug)
  const seen = new Map<string, OpenFdaDrug>();

  for (const result of data.results) {
    const openfda = result.openfda;
    if (!openfda) continue;

    const genericName = openfda.generic_name?.[0] ?? "";
    if (!genericName) continue;

    const key = genericName.toLowerCase();
    if (seen.has(key)) continue;

    seen.set(key, {
      generic_name: genericName,
      brand_name: openfda.brand_name?.[0] ?? "",
      manufacturer: openfda.manufacturer_name?.[0] ?? "",
      set_id: openfda.spl_set_id?.[0] ?? "",
    });
  }

  const drugs = [...seen.values()];
  cache.set(cacheKey, drugs, TTL.SEARCH);
  return drugs;
}
