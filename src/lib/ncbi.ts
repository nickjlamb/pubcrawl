import { cache, TTL } from "./cache.js";

const BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TOOL = "pubcrawl";
const EMAIL = "nick@pharmatools.ai";
const REQUEST_DELAY_MS = 300;
const TIMEOUT_MS = 15000;

let apiKey: string | undefined;
let lastRequestTime = 0;

export function setApiKey(key: string): void {
  apiKey = key;
}

function buildParams(extra: Record<string, string | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  params.set("tool", TOOL);
  params.set("email", EMAIL);
  if (apiKey) params.set("api_key", apiKey);

  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) params.set(key, value);
  }
  return params;
}

async function rateLimitedFetch(url: string): Promise<Response> {
  const minDelay = apiKey ? 100 : REQUEST_DELAY_MS;
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < minDelay) {
    await new Promise((resolve) => setTimeout(resolve, minDelay - elapsed));
  }

  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`NCBI API error: ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function esearch(params: {
  db?: string;
  term: string;
  retmax?: number;
  sort?: string;
  datetype?: string;
  mindate?: string;
  maxdate?: string;
}): Promise<{ idlist: string[]; count: number }> {
  const cacheKey = `esearch:${JSON.stringify(params)}`;
  const cached = cache.get<{ idlist: string[]; count: number }>(cacheKey);
  if (cached) return cached;

  const urlParams = buildParams({
    db: params.db ?? "pubmed",
    term: params.term,
    retmax: String(params.retmax ?? 10),
    sort: params.sort,
    datetype: params.datetype,
    mindate: params.mindate,
    maxdate: params.maxdate,
    retmode: "json",
  });

  const url = `${BASE_URL}/esearch.fcgi?${urlParams}`;
  const response = await rateLimitedFetch(url);
  const data = await response.json();

  const result = {
    idlist: data.esearchresult?.idlist ?? [],
    count: parseInt(data.esearchresult?.count ?? "0", 10),
  };

  cache.set(cacheKey, result, TTL.SEARCH);
  return result;
}

export async function esummary(params: {
  db?: string;
  id: string[];
}): Promise<Record<string, unknown>> {
  if (params.id.length === 0) return {};

  const cacheKey = `esummary:${params.db ?? "pubmed"}:${params.id.join(",")}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  const urlParams = buildParams({
    db: params.db ?? "pubmed",
    id: params.id.join(","),
    retmode: "json",
  });

  const url = `${BASE_URL}/esummary.fcgi?${urlParams}`;
  const response = await rateLimitedFetch(url);
  const data = await response.json();

  const result = data.result ?? {};
  cache.set(cacheKey, result, TTL.SUMMARY);
  return result;
}

export async function efetch(params: {
  db?: string;
  id: string;
  rettype?: string;
  retmode?: string;
}): Promise<string> {
  const cacheKey = `efetch:${params.db ?? "pubmed"}:${params.id}:${params.rettype ?? "xml"}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) return cached;

  const urlParams = buildParams({
    db: params.db ?? "pubmed",
    id: params.id,
    rettype: params.rettype ?? "xml",
    retmode: params.retmode ?? "xml",
  });

  const url = `${BASE_URL}/efetch.fcgi?${urlParams}`;
  const response = await rateLimitedFetch(url);
  const text = await response.text();

  const ttl = params.db === "pmc" ? TTL.FULLTEXT : TTL.ABSTRACT;
  cache.set(cacheKey, text, ttl);
  return text;
}

export async function elink(params: {
  dbfrom?: string;
  db?: string;
  id: string;
  cmd?: string;
  linkname?: string;
}): Promise<{ links: Array<{ id: string; score?: number }> }> {
  const cacheKey = `elink:${JSON.stringify(params)}`;
  const cached = cache.get<{ links: Array<{ id: string; score?: number }> }>(cacheKey);
  if (cached) return cached;

  const urlParams = buildParams({
    dbfrom: params.dbfrom ?? "pubmed",
    db: params.db ?? "pubmed",
    id: params.id,
    cmd: params.cmd,
    linkname: params.linkname,
    retmode: "json",
  });

  const url = `${BASE_URL}/elink.fcgi?${urlParams}`;
  const response = await rateLimitedFetch(url);
  const data = await response.json();

  const linkSets = data.linksets ?? [];
  const links: Array<{ id: string; score?: number }> = [];

  for (const linkSet of linkSets) {
    const linkSetDbs = linkSet.linksetdbs ?? [];
    for (const lsdb of linkSetDbs) {
      const dbLinks = lsdb.links ?? [];
      for (const link of dbLinks) {
        if (typeof link === "object" && link !== null) {
          links.push({ id: String(link.id), score: link.score ? Number(link.score) : undefined });
        } else {
          links.push({ id: String(link) });
        }
      }
    }
  }

  const result = { links };
  cache.set(cacheKey, result, TTL.RELATED);
  return result;
}

export async function pmidToPmcid(pmid: string): Promise<string | null> {
  const cacheKey = `pmid2pmc:${pmid}`;
  const cached = cache.get<string | null>(cacheKey);
  if (cached !== undefined) return cached;

  const urlParams = buildParams({
    dbfrom: "pubmed",
    db: "pmc",
    id: pmid,
    linkname: "pubmed_pmc",
    retmode: "json",
  });

  const url = `${BASE_URL}/elink.fcgi?${urlParams}`;
  const response = await rateLimitedFetch(url);
  const data = await response.json();

  const linkSets = data.linksets ?? [];
  let pmcid: string | null = null;

  for (const linkSet of linkSets) {
    const linkSetDbs = linkSet.linksetdbs ?? [];
    for (const lsdb of linkSetDbs) {
      if (lsdb.linkname === "pubmed_pmc" && lsdb.links?.length > 0) {
        const rawId = lsdb.links[0];
        pmcid = `PMC${typeof rawId === "object" ? rawId.id : rawId}`;
        break;
      }
    }
    if (pmcid) break;
  }

  cache.set(cacheKey, pmcid, TTL.ABSTRACT);
  return pmcid;
}
