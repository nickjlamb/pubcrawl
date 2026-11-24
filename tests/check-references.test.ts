import { describe, it, expect, vi } from "vitest";
import {
  checkReferences,
  summariseChecks,
  isFlagged,
  type ReferenceLookups,
} from "../src/tools/check-references.js";
import type { ParsedReference } from "../src/lib/references.js";

function ref(n: number, overrides: Partial<ParsedReference>): ParsedReference {
  return {
    n, label: String(n), pmid: "", doi: "", title: "", text: "", first_author: "", year: "",
    source: "", volume: "", first_page: "", type: "journal", ...overrides,
  };
}

const TAU = { title: "Tau and tauopathies.", authors: [{ name: "Arendt T" }], pubdate: "2016 Sep", volume: "126", pages: "238-292", pubtype: ["Journal Article", "Review"] };
const RETRACTED = { title: "A study that was later withdrawn.", authors: [{ name: "Smith J" }], pubdate: "2020", pubtype: ["Journal Article", "Retracted Publication"] };
const OTHER = { title: "Global cancer statistics.", authors: [{ name: "Jemal A" }], pubdate: "2011", volume: "61", pages: "69-90", pubtype: ["Journal Article"] };

/** Lookups that answer from fixed tables, so each test states exactly what the sources "know". */
function lookups(tables: {
  pubmed?: Record<string, unknown>;
  crossref?: Record<string, Record<string, unknown> | null>;
  registered?: string[];
  search?: Record<string, unknown>[];
  failPubmed?: boolean;
  failCrossref?: boolean;
  failSearch?: boolean;
}): ReferenceLookups & { calls: { crossref: number; doi: number; search: number } } {
  const calls = { crossref: 0, doi: 0, search: 0 };
  return {
    calls,
    pubmedSummaries: async (pmids) => {
      if (tables.failPubmed) throw new Error("NCBI API error: 503");
      const out: Record<string, unknown> = {};
      for (const pmid of pmids) out[pmid] = tables.pubmed?.[pmid] ?? { uid: pmid, error: "cannot get document summary" };
      return out;
    },
    crossrefWork: async (doi) => {
      calls.crossref += 1;
      if (tables.failCrossref) throw new Error("Crossref API error: 503");
      return tables.crossref?.[doi] ?? null;
    },
    doiIsRegistered: async (doi) => {
      calls.doi += 1;
      return (tables.registered ?? []).includes(doi);
    },
    searchCrossref: async () => {
      calls.search += 1;
      if (tables.failSearch) throw new Error("Crossref API error: 503");
      return tables.search ?? [];
    },
  };
}

describe("checkReferences", () => {
  it("resolves a reference whose PMID matches, without calling Crossref", async () => {
    const sources = lookups({ pubmed: { "27615390": TAU } });
    const [check] = await checkReferences([ref(1, { pmid: "27615390", doi: "10.1016/j.brainresbull.2016.08.018", title: "Tau and tauopathies" })], sources);
    expect(check).toMatchObject({ status: "resolved", matched_by: "pmid", retracted: false });
    expect(sources.calls).toEqual({ crossref: 0, doi: 0, search: 0 });
  });

  it("reports a cited article that PubMed marks as retracted", async () => {
    const [check] = await checkReferences([ref(1, { pmid: "111", title: "A study that was later withdrawn" })], lookups({ pubmed: { "111": RETRACTED } }));
    expect(check.status).toBe("resolved");
    expect(check.retracted).toBe(true);
    expect(check.warning).toBeDefined();
    expect(isFlagged(check)).toBe(true);
  });

  it("resolves a DOI-only reference through Crossref, with retraction status unchecked", async () => {
    const sources = lookups({ crossref: { "10.1103/RevModPhys.90.021001": { DOI: "10.1103/revmodphys.90.021001", title: ["Colloquium: Excitons in atomically thin transition metal dichalcogenides"] } } });
    const [check] = await checkReferences([ref(1, { doi: "10.1103/RevModPhys.90.021001", title: "Colloquium: excitons in atomically thin transition metal dichalcogenides" })], sources);
    expect(check).toMatchObject({ status: "resolved", matched_by: "doi", retracted: null });
    expect(isFlagged(check)).toBe(false);
  });

  it("marks a reference not_found when its DOI is unregistered and the title is nowhere", async () => {
    const [check] = await checkReferences([ref(1, { doi: "10.9999/made.up.2024", title: "Deep learning biomarkers of imaginary disease", first_author: "Nobody", year: "2024" })], lookups({}));
    expect(check.status).toBe("not_found");
    expect(check.issues).toEqual(["DOI 10.9999/made.up.2024 is not a registered DOI."]);
    expect(check.retracted).toBeNull();
    expect(isFlagged(check)).toBe(true);
  });

  it("marks a reference not_found when its PMID is a different record and the title is nowhere", async () => {
    const [check] = await checkReferences([ref(1, { pmid: "21296855", title: "Deep learning biomarkers of imaginary disease" })], lookups({ pubmed: { "21296855": OTHER } }));
    expect(check.status).toBe("not_found");
    expect(check.issues?.[0]).toBe('PMID 21296855 is a different record: "Global cancer statistics".');
  });

  it("marks a reference wrong_identifier when the title exists under another DOI", async () => {
    const sources = lookups({
      pubmed: { "21296855": OTHER },
      search: [{ DOI: "10.1016/j.brainresbull.2016.08.018", title: ["Tau and tauopathies"] }],
    });
    const [check] = await checkReferences([ref(1, { pmid: "21296855", title: "Tau and tauopathies" })], sources);
    expect(check).toMatchObject({
      status: "wrong_identifier",
      found: { doi: "10.1016/j.brainresbull.2016.08.018", title: "Tau and tauopathies" },
    });
  });

  it("resolves through the DOI when the PMID is wrong, and keeps the PMID problem on record", async () => {
    const sources = lookups({
      pubmed: { "21296855": OTHER },
      crossref: { "10.1016/j.brainresbull.2016.08.018": { DOI: "10.1016/j.brainresbull.2016.08.018", title: ["Tau and tauopathies"] } },
    });
    const [check] = await checkReferences([ref(1, { pmid: "21296855", doi: "10.1016/j.brainresbull.2016.08.018", title: "Tau and tauopathies" })], sources);
    expect(check).toMatchObject({ status: "resolved", matched_by: "doi" });
    expect(check.issues).toHaveLength(1);
  });

  it("does not judge a DOI registered outside Crossref", async () => {
    const [check] = await checkReferences([ref(1, { doi: "10.48550/arXiv.2401.00001", title: "A preprint" })], lookups({ registered: ["10.48550/arXiv.2401.00001"] }));
    expect(check).toMatchObject({ status: "not_checked", not_checked_reason: "doi_outside_crossref" });
  });

  it("reports a reference with no identifier as not_checked, never as clean", async () => {
    const [check] = await checkReferences([ref(1, { title: "A book chapter", type: "book" })], lookups({}));
    expect(check).toMatchObject({ status: "not_checked", not_checked_reason: "no_identifier", retracted: null });
  });

  it("turns a failed lookup into not_checked, not a verdict", async () => {
    const pubmedDown = await checkReferences([ref(1, { pmid: "27615390", title: "Tau and tauopathies" })], lookups({ failPubmed: true }));
    expect(pubmedDown[0]).toMatchObject({ status: "not_checked", not_checked_reason: "lookup_failed" });

    const crossrefDown = await checkReferences([ref(1, { doi: "10.1000/x", title: "Tau and tauopathies" })], lookups({ failCrossref: true }));
    expect(crossrefDown[0]).toMatchObject({ status: "not_checked", not_checked_reason: "lookup_failed" });

    const searchDown = await checkReferences([ref(1, { doi: "10.9999/made.up", title: "Nowhere" })], lookups({ failSearch: true }));
    expect(searchDown[0]).toMatchObject({ status: "not_checked", not_checked_reason: "lookup_failed" });
    expect(searchDown[0].issues).toEqual(["DOI 10.9999/made.up is not a registered DOI."]);
  });

  it("stops making external lookups at the limit and says so", async () => {
    const sources = lookups({});
    const many = [1, 2, 3].map((n) => ref(n, { doi: `10.9999/x${n}`, title: `Title number ${n}` }));
    const checks = await checkReferences(many, sources, 2);
    expect(sources.calls.crossref + sources.calls.doi + sources.calls.search).toBe(2);
    expect(checks.filter((c) => c.not_checked_reason === "lookup_limit")).toHaveLength(3);
  });

  it("asks PubMed once for the whole list and keeps list order", async () => {
    const sources = lookups({ pubmed: { "1": TAU, "2": OTHER } });
    const spy = vi.spyOn(sources, "pubmedSummaries");
    const checks = await checkReferences(
      [ref(1, { pmid: "1", title: "Tau and tauopathies" }), ref(2, { title: "No identifier" }), ref(3, { pmid: "2", title: "Global cancer statistics" })],
      sources,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(["1", "2"]);
    expect(checks.map((c) => [c.n, c.status])).toEqual([[1, "resolved"], [2, "not_checked"], [3, "resolved"]]);
  });
});

describe("summariseChecks", () => {
  it("counts by status, retracted citations and not-checked reasons", async () => {
    const sources = lookups({ pubmed: { "1": TAU, "2": RETRACTED }, registered: ["10.48550/a"] });
    const checks = await checkReferences(
      [
        ref(1, { pmid: "1", title: "Tau and tauopathies" }),
        ref(2, { pmid: "2", title: "A study that was later withdrawn" }),
        ref(3, { doi: "10.9999/made.up", title: "Nowhere at all in any index" }),
        ref(4, { title: "A book" }),
        ref(5, { doi: "10.48550/a", title: "A preprint" }),
      ],
      sources,
    );
    expect(summariseChecks(checks)).toEqual({
      summary: { resolved: 2, wrong_identifier: 0, not_found: 1, not_checked: 2, retracted_references: 1 },
      not_checked_reasons: { no_identifier: 1, doi_outside_crossref: 1 },
    });
    expect(checks.filter(isFlagged).map((c) => c.n)).toEqual([2, 3]);
  });

  it("omits not_checked_reasons when everything was checked", async () => {
    const checks = await checkReferences([ref(1, { pmid: "1", title: "Tau and tauopathies" })], lookups({ pubmed: { "1": TAU } }));
    expect(summariseChecks(checks).not_checked_reasons).toBeUndefined();
  });
});
