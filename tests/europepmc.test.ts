import { describe, it, expect } from "vitest";
import { formatEuropePmcResult, plainAbstract } from "../src/lib/europepmc.js";

// A representative Europe PMC `core` result for a published journal article.
const medResult = {
  id: "38127654",
  source: "MED",
  pmid: "38127654",
  pmcid: "PMC10800000",
  doi: "10.1056/NEJMoa2307563",
  title: "Semaglutide and Cardiovascular Outcomes in Type 2 Diabetes.",
  authorString: "Smith J, Doe A, Brown C.",
  journalInfo: {
    volume: "390",
    issue: "3",
    yearOfPublication: 2024,
    journal: { title: "The New England journal of medicine", isoabbreviation: "N Engl J Med" },
  },
  pubYear: "2024",
  abstractText: "Background: Semaglutide reduced cardiovascular events. ".repeat(20),
  isOpenAccess: "N",
  inEPMC: "Y",
  citedByCount: 142,
};

// A preprint result (bioRxiv-style) — source "PPR", no PMID/PMCID.
const pprResult = {
  id: "PPR123456",
  source: "PPR",
  doi: "10.1101/2024.01.15.575000",
  title: "A Preprint on GLP-1 Signalling.",
  authorString: "Lee K, Patel R.",
  journalInfo: { journal: { title: "bioRxiv" }, yearOfPublication: 2024 },
  pubYear: "2024",
  abstractText: "We report preliminary findings.",
  isOpenAccess: "Y",
  citedByCount: 3,
};

describe("formatEuropePmcResult — journal article", () => {
  const a = formatEuropePmcResult(medResult);

  it("maps identifiers and metadata", () => {
    expect(a).toMatchObject({
      id: "38127654",
      source: "MED",
      pmid: "38127654",
      pmcid: "PMC10800000",
      doi: "10.1056/NEJMoa2307563",
      journal: "The New England journal of medicine",
      year: "2024",
      cited_by_count: 142,
    });
  });

  it("splits authorString into an array (matching search_pubmed's shape)", () => {
    expect(a.authors).toEqual(["Smith J", "Doe A", "Brown C"]);
    expect(Array.isArray(a.authors)).toBe(true);
  });

  it("flags it as not a preprint, not open access, but full-text available", () => {
    expect(a.is_preprint).toBe(false);
    expect(a.is_open_access).toBe(false);
    expect(a.has_full_text).toBe(true); // inEPMC === "Y"
  });

  it("populates a REAL abstract snippet (capped at 300 chars)", () => {
    expect(a.abstract_snippet.length).toBe(300);
    expect(a.abstract_snippet).toContain("Semaglutide reduced cardiovascular events");
    // Regression guard vs the search_pubmed bug: the snippet must be the
    // abstract, never a copy of the title.
    expect(a.abstract_snippet).not.toBe(a.title);
  });

  it("builds the canonical Europe PMC article URL", () => {
    expect(a.url).toBe("https://europepmc.org/article/MED/38127654");
  });
});

describe("formatEuropePmcResult — preprint", () => {
  const p = formatEuropePmcResult(pprResult);

  it("flags source PPR as a preprint", () => {
    expect(p.is_preprint).toBe(true);
    expect(p.is_open_access).toBe(true);
  });

  it("leaves pmid/pmcid empty and still builds a URL from source+id", () => {
    expect(p.pmid).toBe("");
    expect(p.pmcid).toBe("");
    expect(p.url).toBe("https://europepmc.org/article/PPR/PPR123456");
  });

  it("reports the preprint server as the journal", () => {
    expect(p.journal).toBe("bioRxiv");
  });
});

describe("formatEuropePmcResult — defensive defaults", () => {
  it("degrades gracefully on an empty result", () => {
    const e = formatEuropePmcResult({});
    expect(e).toEqual({
      id: "",
      source: "",
      pmid: "",
      pmcid: "",
      doi: "",
      title: "",
      retracted: false,
      authors: [],
      journal: "",
      year: "",
      is_preprint: false,
      is_open_access: false,
      cited_by_count: 0,
      has_full_text: false,
      abstract_snippet: "",
      url: "",
    });
  });

  it("falls back to the ISO abbreviation when journal.title is absent", () => {
    const r = formatEuropePmcResult({
      id: "1",
      source: "MED",
      journalInfo: { journal: { isoabbreviation: "N Engl J Med" } },
    });
    expect(r.journal).toBe("N Engl J Med");
  });

  it("falls back to journalInfo.yearOfPublication when pubYear is absent", () => {
    const r = formatEuropePmcResult({
      id: "1",
      source: "MED",
      journalInfo: { yearOfPublication: 2019, journal: {} },
    });
    expect(r.year).toBe("2019");
  });
});

describe("plainAbstract", () => {
  it("turns structured-abstract headings into labels", () => {
    // The start of PMID 9500320's abstract as Europe PMC returned it on 2026-11-22.
    const html =
      "<h4>Background</h4>We investigated a consecutive series of children.<h4>Methods</h4>12 children were referred.";
    expect(plainAbstract(html)).toBe(
      "Background: We investigated a consecutive series of children. Methods: 12 children were referred.",
    );
  });

  it("strips inline markup and decodes entities", () => {
    expect(plainAbstract("<i>BRCA1</i> &amp; H<sub>2</sub>O at 5&nbsp;mg, p&lt;0.05 &#8212; &#x3b1;-blocker")).toBe(
      "BRCA1 & H2O at 5 mg, p<0.05 \u2014 \u03b1-blocker",
    );
  });

  it("keeps comparisons that only look like tags", () => {
    expect(plainAbstract("values < 5 and > 2; n<10")).toBe("values < 5 and > 2; n<10");
  });

  it("does not double a colon already in the heading and leaves plain text alone", () => {
    expect(plainAbstract("<h4>Results:</h4> Fewer events.")).toBe("Results: Fewer events.");
    expect(plainAbstract("Plain abstract text.")).toBe("Plain abstract text.");
    expect(plainAbstract("")).toBe("");
  });

  it("is applied to the snippet before it is cut to 300 characters", () => {
    const article = formatEuropePmcResult({
      abstractText: "<h4>Background</h4>" + "x".repeat(400),
    });
    expect(article.abstract_snippet.startsWith("Background: xxx")).toBe(true);
    expect(article.abstract_snippet).toHaveLength(300);
    expect(article.abstract_snippet).not.toContain("<");
  });
});
