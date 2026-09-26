import { describe, it, expect, beforeEach } from "vitest";
import { buildCompareResult, LabelFetchers } from "../src/tools/compare-labels.js";
import { cache } from "../src/lib/cache.js";

// Fixture labels shaped like the shared engine's output. Content is illustrative;
// the live-label anchors live in benchmark/, not here.
const usLabel = {
  drugName: "OZEMPIC (semaglutide) injection",
  setId: "adec4fd2-6858-4c99-91d4-531f5f2a2d79",
  publishedDate: "2025-01-01",
  dailymedUrl: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=adec4fd2",
  sections: [
    { code: "34067-9", title: "INDICATIONS AND USAGE", content: "US indications text" },
    { code: "34070-3", title: "CONTRAINDICATIONS", content: "US contraindications text" },
  ],
};

const ukLabel = {
  drugName: "Ozempic 0.5 mg solution for injection",
  productId: "9748",
  url: "https://www.medicines.org.uk/emc/product/9748/smpc",
  sections: [
    { code: "4.1", title: "Therapeutic indications", content: "UK indications text" },
    // no 4.3 on purpose
  ],
};

function fetchers(us: typeof usLabel | null, uk: typeof ukLabel | null): LabelFetchers {
  return {
    getUsLabel: async () => us,
    getUkSmpc: async () => uk,
  };
}

function ok<T>(r: T | { error: string }): T {
  if (r && typeof r === "object" && "error" in r) throw new Error(`unexpected error: ${r.error}`);
  return r as T;
}

describe("buildCompareResult", () => {
  beforeEach(() => cache.clear());

  it("pairs US LOINC sections with UK section numbers by topic", async () => {
    const r = ok(await buildCompareResult("semaglutide", ["indications"], fetchers(usLabel, ukLabel)));
    expect(r.comparisons).toHaveLength(1);
    const [c] = r.comparisons;
    expect(c.topic).toBe("Indications");
    expect(c.us_section?.content).toBe("US indications text");
    expect(c.uk_section?.content).toBe("UK indications text");
    expect(c.us_note).toBeUndefined();
    expect(c.uk_note).toBeUndefined();
  });

  it("reports both labels as retrieved, with product names and source URLs", async () => {
    const r = ok(await buildCompareResult("semaglutide", ["indications", "contraindications"], fetchers(usLabel, ukLabel)));
    expect(r.us_label).toEqual({ status: "ok", product: usLabel.drugName, sections_returned: 2 });
    expect(r.uk_label).toEqual({ status: "ok", product: ukLabel.drugName, sections_returned: 1 });
    expect(r.us_source).toBe(usLabel.dailymedUrl);
    expect(r.uk_source).toBe(ukLabel.url);
  });

  it("explains a null section when the label was retrieved but lacks it", async () => {
    const r = ok(await buildCompareResult("semaglutide", ["contraindications"], fetchers(usLabel, ukLabel)));
    const [c] = r.comparisons;
    expect(c.us_section).not.toBeNull();
    expect(c.uk_section).toBeNull();
    expect(c.uk_note).toMatch(/retrieved but has no section 4\.3/);
  });

  it("explains a null section differently when the whole label was unavailable", async () => {
    const r = ok(await buildCompareResult("semaglutide", ["indications"], fetchers(usLabel, null)));
    expect(r.uk_label.status).toBe("unavailable");
    expect(r.uk_label.note).toMatch(/not licensed in the UK|unreachable/);
    expect(r.uk_source).toBeNull();
    expect(r.comparisons[0].uk_note).toMatch(/unavailable/);
    // the available side is untouched
    expect(r.comparisons[0].us_section?.content).toBe("US indications text");
  });

  it("treats a label with zero sections as unavailable", async () => {
    const r = ok(await buildCompareResult("x", ["indications"], fetchers({ ...usLabel, sections: [] }, ukLabel)));
    expect(r.us_label.status).toBe("unavailable");
  });

  it("returns a single explanatory error when neither label is available", async () => {
    const r = await buildCompareResult("notadrug", undefined, fetchers(null, null));
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toMatch(/notadrug/);
      expect(r.error).toMatch(/resolve_drug_name/);
      expect(r.error).toMatch(/unreachable/);
    }
  });

  it("survives a fetcher that rejects, treating that side as unavailable", async () => {
    const rejecting: LabelFetchers = {
      getUsLabel: async () => usLabel,
      getUkSmpc: async () => { throw new Error("boom"); },
    };
    const r = ok(await buildCompareResult("semaglutide", ["indications"], rejecting));
    expect(r.uk_label.status).toBe("unavailable");
    expect(r.us_label.status).toBe("ok");
  });

  it("errors on topics that map to nothing without calling either source", async () => {
    let called = 0;
    const counting: LabelFetchers = {
      getUsLabel: async () => { called++; return usLabel; },
      getUkSmpc: async () => { called++; return ukLabel; },
    };
    const r = await buildCompareResult("semaglutide", ["shelf life"], counting);
    expect("error" in r).toBe(true);
    expect(called).toBe(0);
  });

  it("passes only the mapped codes for the requested topics to each fetcher", async () => {
    const seen: { us?: string[]; uk?: string[] } = {};
    const spying: LabelFetchers = {
      getUsLabel: async (_d, codes) => { seen.us = codes; return usLabel; },
      getUkSmpc: async (_d, codes) => { seen.uk = codes; return ukLabel; },
    };
    await buildCompareResult("semaglutide", ["indications", "contraindications"], spying);
    expect(seen.us).toEqual(["34067-9", "34070-3"]);
    expect(seen.uk).toEqual(["4.1", "4.3"]);
  });

  it("flags a section the engine truncated and says absence proves nothing", async () => {
    const cutUs = { ...usLabel, sections: [{ code: "34067-9", title: "INDICATIONS AND USAGE", content: "First 1,400 characters of a long indications section. …" }] };
    const r = ok(await buildCompareResult("keytruda", ["indications"], fetchers(cutUs, ukLabel)));
    const [c] = r.comparisons;
    expect(c.us_section?.truncated).toBe(true);
    expect(c.us_note).toMatch(/cut at the engine/);
    expect(c.us_note).toContain(usLabel.dailymedUrl);
    expect(c.uk_section?.truncated).toBeUndefined();
    expect(c.uk_note).toBeUndefined();
  });

  it("uses per-side name overrides for the lookups and records them", async () => {
    const seen: { us?: string; uk?: string } = {};
    const spying: LabelFetchers = {
      getUsLabel: async (d) => { seen.us = d; return usLabel; },
      getUkSmpc: async (d) => { seen.uk = d; return ukLabel; },
    };
    const r = ok(await buildCompareResult("dapagliflozin", ["indications"], spying, { us: "Farxiga", uk: "Forxiga" }));
    expect(seen).toEqual({ us: "Farxiga", uk: "Forxiga" });
    expect(r.drug).toBe("dapagliflozin");
    expect(r.lookup_names).toEqual({ us: "Farxiga", uk: "Forxiga" });
    // no override → no lookup_names field
    const plain = ok(await buildCompareResult("apixaban", ["indications"], spying));
    expect(plain.lookup_names).toBeUndefined();
  });

  it("caches by drug and requested sections", async () => {
    let calls = 0;
    const counting: LabelFetchers = {
      getUsLabel: async () => { calls++; return usLabel; },
      getUkSmpc: async () => { calls++; return ukLabel; },
    };
    await buildCompareResult("Semaglutide", ["indications"], counting);
    await buildCompareResult("semaglutide", ["Indications"], counting);
    expect(calls).toBe(2);
  });
});
