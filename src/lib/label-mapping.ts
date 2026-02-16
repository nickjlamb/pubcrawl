export interface SectionMapping {
  topic: string;
  us_loinc: string;
  uk_code: string;
}

export const SECTION_MAP: SectionMapping[] = [
  { topic: "Indications", us_loinc: "34067-9", uk_code: "4.1" },
  { topic: "Dosing", us_loinc: "34068-7", uk_code: "4.2" },
  { topic: "Contraindications", us_loinc: "34070-3", uk_code: "4.3" },
  { topic: "Warnings", us_loinc: "43685-7", uk_code: "4.4" },
  { topic: "Drug Interactions", us_loinc: "34073-7", uk_code: "4.5" },
  { topic: "Pregnancy", us_loinc: "42228-7", uk_code: "4.6" },
  { topic: "Adverse Reactions", us_loinc: "34084-4", uk_code: "4.8" },
  { topic: "Overdosage", us_loinc: "34088-5", uk_code: "4.9" },
  { topic: "Clinical Pharmacology", us_loinc: "34090-1", uk_code: "5.1" },
];

export function filterSectionMap(requestedTopics?: string[]): SectionMapping[] {
  if (!requestedTopics || requestedTopics.length === 0) return SECTION_MAP;

  return SECTION_MAP.filter((mapping) =>
    requestedTopics.some((req) => {
      const lower = req.toLowerCase().trim();
      return (
        mapping.topic.toLowerCase().includes(lower) ||
        lower.includes(mapping.topic.toLowerCase()) ||
        mapping.us_loinc === req ||
        mapping.uk_code === req
      );
    })
  );
}
