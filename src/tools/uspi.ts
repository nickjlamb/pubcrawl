import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchDrugLabels, fetchSplXml } from "../lib/dailymed.js";
import { parseXml, parseSplSections } from "../lib/xml-parser.js";
import { LabelSection, USPIResult } from "../types.js";

// LOINC codes for FDA prescribing information sections
const LOINC_MAP: Record<string, string> = {
  "boxed warning": "34071-1",
  "indications": "34067-9",
  "indications and usage": "34067-9",
  "dosage": "34068-7",
  "dosage and administration": "34068-7",
  "dosage forms": "43678-2",
  "contraindications": "34070-3",
  "warnings": "43685-7",
  "warnings and precautions": "43685-7",
  "adverse reactions": "34084-4",
  "drug interactions": "34073-7",
  "use in specific populations": "42228-7",
  "pregnancy": "42228-7",
  "overdosage": "34088-5",
  "clinical pharmacology": "34090-1",
  "description": "34089-3",
  "how supplied": "34069-5",
  "storage": "44425-7",
  "patient counseling": "34076-0",
  "medication guide": "42231-1",
};

// All known PI LOINC codes
const ALL_PI_CODES = [...new Set(Object.values(LOINC_MAP))];

function resolveLoincCodes(sections?: string[]): string[] | undefined {
  if (!sections || sections.length === 0) return undefined;

  const codes: string[] = [];
  for (const input of sections) {
    const lower = input.toLowerCase().trim();

    // Direct LOINC code (e.g., "34067-9")
    if (/^\d{5}-\d$/.test(lower)) {
      codes.push(lower);
      continue;
    }

    // Fuzzy match against section names
    const match = Object.entries(LOINC_MAP).find(
      ([name]) => name.includes(lower) || lower.includes(name)
    );
    if (match) {
      codes.push(match[1]);
    }
  }

  return codes.length > 0 ? codes : undefined;
}

const schema = {
  drug: z.string().describe("Drug name to look up (e.g., 'metformin', 'atorvastatin')"),
  sections: z
    .array(z.string())
    .optional()
    .describe(
      "Specific sections to retrieve (e.g., ['indications', 'adverse reactions', 'contraindications']). Returns all sections if omitted."
    ),
};

export function registerUspiTool(server: McpServer): void {
  server.tool(
    "get_uspi",
    "Get FDA US Prescribing Information (USPI) for a drug from DailyMed. Returns structured labelling sections with LOINC codes.",
    schema,
    async (params) => {
      try {
        const searchResults = await searchDrugLabels(params.drug);

        if (searchResults.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: `No FDA labelling found for "${params.drug}"` }, null, 2),
            }],
            isError: true,
          };
        }

        // Select best match: filter by drug name, sort by date descending
        const drugLower = params.drug.toLowerCase();
        const sorted = [...searchResults].sort((a, b) => {
          const aMatch = a.title.toLowerCase().includes(drugLower) ? 1 : 0;
          const bMatch = b.title.toLowerCase().includes(drugLower) ? 1 : 0;
          if (aMatch !== bMatch) return bMatch - aMatch;
          return b.published_date.localeCompare(a.published_date);
        });

        const best = sorted[0];
        const xml = await fetchSplXml(best.setid);
        const parsed = parseXml(xml);

        // Navigate SPL XML structure: document > component > structuredBody
        // component may be an array due to XML parser isArray config
        const document = parsed?.document;
        const docComponent = document?.component;
        const firstComponent = Array.isArray(docComponent) ? docComponent[0] : docComponent;
        const structuredBody = firstComponent?.structuredBody;

        const requestedCodes = resolveLoincCodes(params.sections);
        const rawSections = parseSplSections(structuredBody, requestedCodes);

        // If no specific sections requested and we got nothing from filtering, try all PI codes
        const sections: LabelSection[] = rawSections.length > 0
          ? rawSections.map((s) => ({ code: s.code, title: s.title, content: s.content }))
          : parseSplSections(structuredBody, ALL_PI_CODES).map((s) => ({
              code: s.code,
              title: s.title,
              content: s.content,
            }));

        const result: USPIResult = {
          drug_name: best.title,
          setid: best.setid,
          spl_version: best.spl_version,
          published_date: best.published_date,
          sections,
          dailymed_url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${best.setid}`,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error fetching USPI: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
