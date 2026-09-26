import { describe, it, expect } from "vitest";
import { SECTION_MAP, filterSectionMap } from "../src/lib/label-mapping.js";

describe("SECTION_MAP", () => {
  it("pairs every US LOINC code with exactly one UK section number", () => {
    const us = SECTION_MAP.map((m) => m.us_loinc);
    const uk = SECTION_MAP.map((m) => m.uk_code);
    expect(new Set(us).size).toBe(SECTION_MAP.length);
    expect(new Set(uk).size).toBe(SECTION_MAP.length);
  });

  it("maps the sections compare_labels is documented to cover", () => {
    const byTopic = Object.fromEntries(SECTION_MAP.map((m) => [m.topic, m]));
    expect(byTopic["Indications"]).toEqual({ topic: "Indications", us_loinc: "34067-9", uk_code: "4.1" });
    expect(byTopic["Contraindications"].uk_code).toBe("4.3");
    expect(byTopic["Warnings"].us_loinc).toBe("43685-7");
    expect(byTopic["Adverse Reactions"].uk_code).toBe("4.8");
  });
});

describe("filterSectionMap", () => {
  it("returns every mapping when no topics are requested", () => {
    expect(filterSectionMap()).toEqual(SECTION_MAP);
    expect(filterSectionMap([])).toEqual(SECTION_MAP);
  });

  it("matches topics case-insensitively and by substring in either direction", () => {
    expect(filterSectionMap(["INDICATIONS"]).map((m) => m.topic)).toEqual(["Indications"]);
    expect(filterSectionMap(["adverse"]).map((m) => m.topic)).toEqual(["Adverse Reactions"]);
    // request longer than the topic: "warnings and precautions" contains "warnings"
    expect(filterSectionMap(["warnings and precautions"]).map((m) => m.topic)).toEqual(["Warnings"]);
  });

  it("matches by US LOINC code or UK section number", () => {
    expect(filterSectionMap(["34070-3"]).map((m) => m.topic)).toEqual(["Contraindications"]);
    expect(filterSectionMap(["4.6"]).map((m) => m.topic)).toEqual(["Pregnancy"]);
  });

  it("preserves canonical order regardless of request order", () => {
    const topics = filterSectionMap(["overdosage", "indications", "dosing"]).map((m) => m.topic);
    expect(topics).toEqual(["Indications", "Dosing", "Overdosage"]);
  });

  it("returns an empty list for unknown topics", () => {
    expect(filterSectionMap(["shelf life"])).toEqual([]);
  });
});

describe("filterSectionMap — topic-name edge cases", () => {
  it("does not let 'indications' select Contraindications, and vice versa", () => {
    expect(filterSectionMap(["indications"]).map((m) => m.topic)).toEqual(["Indications"]);
    expect(filterSectionMap(["contraindications"]).map((m) => m.topic)).toEqual(["Contraindications"]);
  });

  it("matches a single word of a multi-word topic", () => {
    expect(filterSectionMap(["interactions"]).map((m) => m.topic)).toEqual(["Drug Interactions"]);
    expect(filterSectionMap(["pharmacology"]).map((m) => m.topic)).toEqual(["Clinical Pharmacology"]);
  });

  it("matches a longer phrase that contains the topic as a whole word", () => {
    expect(filterSectionMap(["special warnings and precautions for use"]).map((m) => m.topic)).toEqual(["Warnings"]);
    expect(filterSectionMap(["indications and usage"]).map((m) => m.topic)).toEqual(["Indications"]);
  });
});

import { markTruncated } from "../src/lib/label-mapping.js";

describe("markTruncated", () => {
  it("flags sections the engine cut (trailing ellipsis) and leaves the rest untouched", () => {
    const out = markTruncated([
      { code: "4.4", title: "Warnings", content: "Long text that was cut. …" },
      { code: "4.3", title: "Contraindications", content: "Complete text." },
    ]);
    expect(out[0].truncated).toBe(true);
    expect(out[1].truncated).toBeUndefined();
    expect(out[0].content).toBe("Long text that was cut. …"); // content is never altered
  });
});
