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

const words = (s: string): string[] => s.split(/[^a-z0-9.]+/).filter(Boolean);

/**
 * Does a requested topic name refer to this mapping?
 *
 * Matches on the whole topic, a prefix of it ("indic" -> Indications), one of
 * its words ("interactions" -> Drug Interactions), or the topic appearing as a
 * whole word in a longer request ("special warnings and precautions" ->
 * Warnings). Deliberately not a bare substring test: "indications" must not
 * also select Contraindications.
 */
function topicMatches(mapping: SectionMapping, request: string): boolean {
  const topic = mapping.topic.toLowerCase();
  const req = request.toLowerCase().trim();
  if (!req) return false;
  if (req === mapping.us_loinc || req === mapping.uk_code) return true;
  if (topic === req || topic.startsWith(req)) return true;
  const topicWords = words(topic);
  const reqWords = words(req);
  if (topicWords.includes(req)) return true;
  if (reqWords.includes(topic)) return true;
  // whole-phrase, word-bounded containment ("warnings and precautions" ⊇ "warnings")
  const phrase = new RegExp(`(^|[^a-z0-9])${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
  return phrase.test(req);
}

export function filterSectionMap(requestedTopics?: string[]): SectionMapping[] {
  if (!requestedTopics || requestedTopics.length === 0) return SECTION_MAP;
  return SECTION_MAP.filter((mapping) => requestedTopics.some((req) => topicMatches(mapping, req)));
}

/**
 * The shared engine caps each section's text (currently 1,400 characters) and
 * appends " …" when it does. Mark those sections so callers know the text is
 * verbatim but incomplete.
 */
export function markTruncated<T extends { content: string }>(sections: T[]): (T & { truncated?: boolean })[] {
  return sections.map((s) => (/\u2026\s*$/.test(s.content) ? { ...s, truncated: true } : s));
}
