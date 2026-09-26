import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUsLabel, getUkSmpc } from "@pharmatools/drug-data";
import { cache, TTL } from "../lib/cache.js";
import { filterSectionMap, markTruncated } from "../lib/label-mapping.js";
import {
  CompareLabelsResult,
  LabelComparison,
  LabelSection,
  LabelSourceStatus,
} from "../types.js";

const schema = {
  drug: z.string().describe("Drug name to compare across US and UK labelling"),
  us_drug: z
    .string()
    .optional()
    .describe("Name to use for the US lookup when it differs from `drug` (e.g. a US-only brand). Defaults to `drug`."),
  uk_drug: z
    .string()
    .optional()
    .describe("Name to use for the UK lookup when it differs from `drug` — brands often do (Farxiga/Forxiga, Prilosec/Losec). Defaults to `drug`."),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      "Specific topics to compare (e.g., ['indications', 'adverse reactions']). Compares all mapped sections if omitted."
    ),
};

/** Minimal shape of a fetched label, as the shared engine returns it. */
interface FetchedLabel {
  drugName: string;
  sections: LabelSection[];
}

/** The two fetchers, injectable so the pairing logic can be tested offline. */
export interface LabelFetchers {
  getUsLabel: (drug: string, codes: string[]) => Promise<(FetchedLabel & { dailymedUrl: string }) | null>;
  getUkSmpc: (drug: string, codes: string[]) => Promise<(FetchedLabel & { url: string }) | null>;
}

const defaultFetchers: LabelFetchers = { getUsLabel, getUkSmpc };

const US_UNAVAILABLE =
  "US label not retrieved: no openFDA/DailyMed product matched this name, or the source was unreachable. " +
  "If the name is a brand, try resolve_drug_name and retry with the generic.";
const UK_UNAVAILABLE =
  "UK SmPC not retrieved: no eMC product matched this name (the drug may not be licensed in the UK under it), " +
  "or the source was unreachable. If the name is a brand, try resolve_drug_name and retry with the generic.";

const TRUNCATED_NOTE = (side: string, url: string | null) =>
  `${side} text is verbatim but cut at the engine's per-section cap (ends with …); absence of a phrase here proves nothing — read the full section at ${url ?? "the source"}`;
const res_us_url = (us: { dailymedUrl: string } | null) => us?.dailymedUrl ?? null;
const res_uk_url = (uk: { url: string } | null) => uk?.url ?? null;

function sourceStatus(label: FetchedLabel | null, note: string): LabelSourceStatus {
  if (!label || label.sections.length === 0) {
    return { status: "unavailable", product: null, sections_returned: 0, note };
  }
  return { status: "ok", product: label.drugName, sections_returned: label.sections.length };
}

/**
 * Build a CompareLabelsResult by fetching both labels from the shared engine and
 * pairing equivalent sections (US LOINC <-> UK section number). Cached for 24h.
 *
 * A null section is never left unexplained: the paired *_note says whether the
 * whole label was unavailable or the label was retrieved but lacks that section.
 */
export interface CompareNames {
  /** Name used for the US lookup; defaults to `drug`. */
  us?: string;
  /** Name used for the UK lookup; defaults to `drug`. */
  uk?: string;
}

export async function buildCompareResult(
  drug: string,
  sections?: string[],
  fetchers: LabelFetchers = defaultFetchers,
  names: CompareNames = {}
): Promise<CompareLabelsResult | { error: string }> {
  const mappings = filterSectionMap(sections);
  if (mappings.length === 0) {
    return { error: "No matching section mappings found for the requested topics" };
  }

  const usName = names.us?.trim() || drug;
  const ukName = names.uk?.trim() || drug;
  const cacheKey = `compare:${usName.toLowerCase()}|${ukName.toLowerCase()}:${(sections ?? []).join(",").toLowerCase()}`;
  const cached = cache.get<CompareLabelsResult>(cacheKey);
  if (cached) return cached;

  const usCodes = mappings.map((m) => m.us_loinc);
  const ukCodes = mappings.map((m) => m.uk_code);

  // Fetch both in parallel — allow partial results. The engine already returns
  // null on failure, so a rejection here is unexpected; treat it as unavailable.
  const [usSettled, ukSettled] = await Promise.allSettled([
    fetchers.getUsLabel(usName, usCodes),
    fetchers.getUkSmpc(ukName, ukCodes),
  ]);
  const us = usSettled.status === "fulfilled" ? usSettled.value : null;
  const uk = ukSettled.status === "fulfilled" ? ukSettled.value : null;

  const usStatus = sourceStatus(us, US_UNAVAILABLE);
  const ukStatus = sourceStatus(uk, UK_UNAVAILABLE);

  if (usStatus.status === "unavailable" && ukStatus.status === "unavailable") {
    return {
      error:
        `No labelling retrieved for "${usName === ukName ? drug : `${usName}" (US) / "${ukName}" (UK)`}" from openFDA/DailyMed or the eMC. ` +
        "Either no product is listed under that name in these sources (try resolve_drug_name for the generic name), " +
        "or a source was unreachable.",
    };
  }

  const usByCode = new Map(markTruncated(us?.sections ?? []).map((s) => [s.code, s]));
  const ukByCode = new Map(markTruncated(uk?.sections ?? []).map((s) => [s.code, s]));

  const comparisons: LabelComparison[] = mappings.map((m) => {
    const usSection = usByCode.get(m.us_loinc) ?? null;
    const ukSection = ukByCode.get(m.uk_code) ?? null;
    const c: LabelComparison = { topic: m.topic, us_section: usSection, uk_section: ukSection };
    if (!usSection) {
      c.us_note =
        usStatus.status === "unavailable"
          ? "US label unavailable (see us_label.note)"
          : `US label retrieved but has no section mapped to ${m.topic} (LOINC ${m.us_loinc})`;
    }
    if (!ukSection) {
      c.uk_note =
        ukStatus.status === "unavailable"
          ? "UK SmPC unavailable (see uk_label.note)"
          : `UK SmPC retrieved but has no section ${m.uk_code} (${m.topic})`;
    }
    if (usSection?.truncated) c.us_note = TRUNCATED_NOTE("US section", res_us_url(us));
    if (ukSection?.truncated) c.uk_note = TRUNCATED_NOTE("UK section", res_uk_url(uk));
    return c;
  });

  const result: CompareLabelsResult = {
    drug,
    ...(usName !== drug || ukName !== drug ? { lookup_names: { us: usName, uk: ukName } } : {}),
    comparisons,
    us_source: us?.dailymedUrl ?? null,
    uk_source: uk?.url ?? null,
    us_label: usStatus,
    uk_label: ukStatus,
  };
  cache.set(cacheKey, result, TTL.LABEL);
  return result;
}

export function registerCompareLabelsTool(server: McpServer): void {
  server.tool(
    "compare_labels",
    "Compare US FDA Prescribing Information vs UK/EU SmPC for a drug side-by-side. Maps equivalent sections (e.g., US Indications ↔ UK 4.1) and returns paired verbatim content. A missing side is always explained: us_label/uk_label say whether the label was retrieved, each comparison notes why a section is null, and sections cut at the engine's length cap are flagged truncated.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        const result = await buildCompareResult(params.drug, params.sections, defaultFetchers, {
          us: params.us_drug,
          uk: params.uk_drug,
        });
        const isError = "error" in result;
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          ...(isError ? { isError: true } : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error comparing labels: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
