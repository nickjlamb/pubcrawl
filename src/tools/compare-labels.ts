import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchDrugLabels, fetchSplXml } from "../lib/dailymed.js";
import { searchEmc, fetchSmpcHtml, parseSmpcSections } from "../lib/emc.js";
import { parseXml, parseSplSections } from "../lib/xml-parser.js";
import { filterSectionMap } from "../lib/label-mapping.js";
import { LabelSection, LabelComparison, CompareLabelsResult } from "../types.js";

const schema = {
  drug: z.string().describe("Drug name to compare across US and UK labelling"),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      "Specific topics to compare (e.g., ['indications', 'adverse reactions']). Compares all mapped sections if omitted."
    ),
};

async function fetchUsSections(
  drugName: string,
  loincCodes: string[]
): Promise<{ sections: Map<string, LabelSection>; source: string | null }> {
  const searchResults = await searchDrugLabels(drugName);
  if (searchResults.length === 0) return { sections: new Map(), source: null };

  const drugLower = drugName.toLowerCase();
  const sorted = [...searchResults].sort((a, b) => {
    const aMatch = a.title.toLowerCase().includes(drugLower) ? 1 : 0;
    const bMatch = b.title.toLowerCase().includes(drugLower) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return b.published_date.localeCompare(a.published_date);
  });

  const best = sorted[0];
  const xml = await fetchSplXml(best.setid);
  const parsed = parseXml(xml);
  const docComponent = parsed?.document?.component;
  const firstComponent = Array.isArray(docComponent) ? docComponent[0] : docComponent;
  const structuredBody = firstComponent?.structuredBody;
  const rawSections = parseSplSections(structuredBody, loincCodes);

  const sectionMap = new Map<string, LabelSection>();
  for (const s of rawSections) {
    sectionMap.set(s.code, { code: s.code, title: s.title, content: s.content });
  }

  return {
    sections: sectionMap,
    source: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${best.setid}`,
  };
}

async function fetchUkSections(
  drugName: string,
  ukCodes: string[]
): Promise<{ sections: Map<string, LabelSection>; source: string | null }> {
  const searchResults = await searchEmc(drugName);
  if (searchResults.length === 0) return { sections: new Map(), source: null };

  const drugLower = drugName.toLowerCase();
  const sorted = [...searchResults].sort((a, b) => {
    const aMatch = a.name.toLowerCase().includes(drugLower) ? 1 : 0;
    const bMatch = b.name.toLowerCase().includes(drugLower) ? 1 : 0;
    return bMatch - aMatch;
  });

  const best = sorted[0];
  const html = await fetchSmpcHtml(best.product_id);
  const rawSections = parseSmpcSections(html, ukCodes);

  const sectionMap = new Map<string, LabelSection>();
  for (const s of rawSections) {
    sectionMap.set(s.code, { code: s.code, title: s.title, content: s.content });
  }

  return {
    sections: sectionMap,
    source: `https://www.medicines.org.uk/emc/product/${best.product_id}/smpc`,
  };
}

export function registerCompareLabelsTool(server: McpServer): void {
  server.tool(
    "compare_labels",
    "Compare US FDA Prescribing Information vs UK/EU SmPC for a drug side-by-side. Maps equivalent sections (e.g., US Indications ↔ UK 4.1) and returns paired content.",
    schema,
    async (params) => {
      try {
        const mappings = filterSectionMap(params.sections);

        if (mappings.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "No matching section mappings found for the requested topics" }, null, 2),
            }],
            isError: true,
          };
        }

        const loincCodes = mappings.map((m) => m.us_loinc);
        const ukCodes = mappings.map((m) => m.uk_code);

        // Fetch both in parallel — allow partial results
        const [usResult, ukResult] = await Promise.allSettled([
          fetchUsSections(params.drug, loincCodes),
          fetchUkSections(params.drug, ukCodes),
        ]);

        const us = usResult.status === "fulfilled" ? usResult.value : { sections: new Map<string, LabelSection>(), source: null };
        const uk = ukResult.status === "fulfilled" ? ukResult.value : { sections: new Map<string, LabelSection>(), source: null };

        if (us.sections.size === 0 && uk.sections.size === 0) {
          const errors: string[] = [];
          if (usResult.status === "rejected") errors.push(`US: ${usResult.reason}`);
          if (ukResult.status === "rejected") errors.push(`UK: ${ukResult.reason}`);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `No labelling found for "${params.drug}" in either US or UK databases`,
                details: errors.length > 0 ? errors : undefined,
              }, null, 2),
            }],
            isError: true,
          };
        }

        const comparisons: LabelComparison[] = mappings.map((mapping) => ({
          topic: mapping.topic,
          us_section: us.sections.get(mapping.us_loinc) ?? null,
          uk_section: uk.sections.get(mapping.uk_code) ?? null,
        }));

        const result: CompareLabelsResult = {
          drug: params.drug,
          comparisons,
          us_source: us.source,
          uk_source: uk.source,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
