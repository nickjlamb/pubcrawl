import * as cheerio from "cheerio";
import { cache, TTL } from "./cache.js";

const BASE_URL = "https://www.medicines.org.uk";
const REQUEST_DELAY_MS = 1000;
const TIMEOUT_MS = 20000;
const USER_AGENT = "PubCrawl/2.0 (pharmatools.ai; nick@pharmatools.ai)";

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
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`eMC error: ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export interface EmcSearchResult {
  product_id: string;
  name: string;
  company: string;
}

export async function searchEmc(drugName: string): Promise<EmcSearchResult[]> {
  const cacheKey = `emc:search:${drugName.toLowerCase()}`;
  const cached = cache.get<EmcSearchResult[]>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ q: drugName });
  const url = `${BASE_URL}/emc/search?${params}`;
  const response = await rateLimitedFetch(url);
  const html = await response.text();

  const $ = cheerio.load(html);
  const results: EmcSearchResult[] = [];

  // Parse search results — look for SmPC links (href contains /smpc)
  $("a[href*='/emc/product/']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const smpcMatch = href.match(/\/emc\/product\/(\d+)\/smpc/);
    if (!smpcMatch) return;

    const product_id = smpcMatch[1];
    const name = $(el).text().trim();

    // Skip generic link text like "Health Professionals (SmPC)"
    if (!name || name.toLowerCase().includes("health professional")) return;

    // Avoid duplicates
    if (results.some((r) => r.product_id === product_id)) return;

    // Try to find company from nearby text
    const parent = $(el).closest("li, tr, div, article");
    const company = parent.find(".company, .manufacturer").text().trim();

    results.push({ product_id, name, company });
  });

  cache.set(cacheKey, results, TTL.SEARCH);
  return results;
}

export async function fetchSmpcHtml(productId: string): Promise<string> {
  const cacheKey = `emc:smpc:${productId}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/emc/product/${productId}/smpc`;
  const response = await rateLimitedFetch(url);
  const html = await response.text();

  cache.set(cacheKey, html, TTL.LABEL);
  return html;
}

// SmPC standard section numbering
const SMPC_SECTION_NAMES: Record<string, string> = {
  "4.1": "Therapeutic indications",
  "4.2": "Posology and method of administration",
  "4.3": "Contraindications",
  "4.4": "Special warnings and precautions for use",
  "4.5": "Interaction with other medicinal products",
  "4.6": "Fertility, pregnancy and lactation",
  "4.7": "Effects on ability to drive and use machines",
  "4.8": "Undesirable effects",
  "4.9": "Overdose",
  "5.1": "Pharmacodynamic properties",
  "5.2": "Pharmacokinetic properties",
  "5.3": "Preclinical safety data",
  "6.1": "List of excipients",
  "6.2": "Incompatibilities",
  "6.3": "Shelf life",
  "6.4": "Special precautions for storage",
  "6.5": "Nature and contents of container",
  "6.6": "Special precautions for disposal",
};

function htmlToText(html: string): string {
  const $ = cheerio.load(html);

  // Replace <br> with newlines
  $("br").replaceWith("\n");
  // Replace <li> with bullet points
  $("li").each((_, el) => {
    $(el).prepend("- ");
    $(el).append("\n");
  });
  // Add newlines after block elements
  $("p, div, tr, h1, h2, h3, h4, h5, h6").each((_, el) => {
    $(el).append("\n");
  });

  return $.text().replace(/\n{3,}/g, "\n\n").trim();
}

export function parseSmpcSections(
  html: string,
  requestedSections?: string[]
): Array<{ code: string; title: string; content: string }> {
  const $ = cheerio.load(html);
  const results: Array<{ code: string; title: string; content: string }> = [];

  // eMC uses numbered headings for SmPC sections
  // Look for section headings matching patterns like "4.1", "4.2", etc.
  type CheerioSelection = ReturnType<typeof $>;
  const sectionElements: Array<{ code: string; title: string; element: CheerioSelection }> = [];

  // Strategy 1: Look for elements with IDs or classes containing section numbers
  $("[id*='SECTION'], [id*='section'], .sectionHeading, h2, h3, h4").each((_, el) => {
    const text = $(el).text().trim();
    const match = text.match(/^(\d+\.?\d*)\s+(.+)/);
    if (match) {
      sectionElements.push({
        code: match[1],
        title: match[2].trim(),
        element: $(el),
      });
    }
  });

  // Strategy 2: If strategy 1 found nothing, scan all text nodes for section headers
  if (sectionElements.length === 0) {
    $("*").each((_, el) => {
      const $el = $(el);
      if ($el.children().length > 0 && !$el.is("a, span, strong, em, b, i")) return;
      const text = $el.text().trim();
      const match = text.match(/^(\d+\.?\d*)\s+(.+)/);
      if (match && SMPC_SECTION_NAMES[match[1]]) {
        sectionElements.push({
          code: match[1],
          title: match[2].trim(),
          element: $el,
        });
      }
    });
  }

  // Extract content between consecutive headings
  for (let i = 0; i < sectionElements.length; i++) {
    const current = sectionElements[i];
    const next = sectionElements[i + 1];

    // Collect all sibling content between this heading and the next
    let content = "";
    let node = current.element.next();
    while (node.length > 0) {
      if (next && node.is(next.element)) break;

      const nodeHtml = $.html(node);
      if (nodeHtml) {
        content += htmlToText(nodeHtml) + "\n";
      }
      node = node.next();
    }

    // If no content from sibling traversal, try parent's content
    if (!content.trim()) {
      const parent = current.element.parent();
      const parentHtml = $.html(parent);
      if (parentHtml) {
        const parentText = htmlToText(parentHtml);
        // Remove the heading text itself
        const headingText = current.element.text().trim();
        content = parentText.replace(headingText, "").trim();
      }
    }

    results.push({
      code: current.code,
      title: current.title,
      content: content.trim(),
    });
  }

  // Filter by requested sections if specified
  if (requestedSections && requestedSections.length > 0) {
    const filtered = results.filter((s) => {
      return requestedSections.some((req) => {
        const lower = req.toLowerCase().trim();
        // Match by section number (e.g., "4.1")
        if (s.code === lower || s.code === req) return true;
        // Match by name substring
        if (s.title.toLowerCase().includes(lower)) return true;
        if (lower.includes("indication")) return s.code === "4.1";
        if (lower.includes("dosage") || lower.includes("dosing") || lower.includes("posology")) return s.code === "4.2";
        if (lower.includes("contraindication")) return s.code === "4.3";
        if (lower.includes("warning") || lower.includes("precaution")) return s.code === "4.4";
        if (lower.includes("interaction")) return s.code === "4.5";
        if (lower.includes("pregnancy") || lower.includes("fertility")) return s.code === "4.6";
        if (lower.includes("adverse") || lower.includes("undesirable") || lower.includes("side effect")) return s.code === "4.8";
        if (lower.includes("overdose") || lower.includes("overdosage")) return s.code === "4.9";
        if (lower.includes("pharmacodynamic")) return s.code === "5.1";
        if (lower.includes("pharmacokinetic")) return s.code === "5.2";
        return false;
      });
    });
    return filtered;
  }

  return results;
}
