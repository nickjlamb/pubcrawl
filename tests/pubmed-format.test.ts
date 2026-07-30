import { describe, it, expect } from "vitest";
import { formatSummaryArticle } from "../src/lib/pubmed-format.js";

// A representative NCBI esummary document. `sorttitle` is a normalised
// (lowercased, de-punctuated) copy of the title that NCBI returns for sorting.
const doc = {
  title: "A Randomised Trial of Semaglutide in Type 2 Diabetes.",
  sorttitle: "a randomised trial of semaglutide in type 2 diabetes",
  authors: [{ name: "Smith J" }, { name: "Doe A" }],
  fulljournalname: "New England Journal of Medicine",
  source: "N Engl J Med",
  pubdate: "2024 Mar 15",
  elocationid: "doi: 10.1056/NEJMoa123456",
};

describe("formatSummaryArticle", () => {
  it("maps the core esummary fields", () => {
    const article = formatSummaryArticle("38127654", doc);
    expect(article).toEqual({
      pmid: "38127654",
      title: "A Randomised Trial of Semaglutide in Type 2 Diabetes.",
      authors: ["Smith J", "Doe A"],
      journal: "New England Journal of Medicine",
      year: "2024",
      doi: "10.1056/NEJMoa123456",
    });
  });

  // Regression: the previous implementation set `abstract_snippet` to
  // `doc.sorttitle`, i.e. the title again under a misleading key — esummary
  // never returns abstract text. Guard against that ever coming back.
  it("does NOT emit an abstract_snippet field", () => {
    const article = formatSummaryArticle("38127654", doc) as Record<string, unknown>;
    expect("abstract_snippet" in article).toBe(false);
  });

  it("never surfaces the sorttitle value anywhere in the output", () => {
    const article = formatSummaryArticle("38127654", doc) as Record<string, unknown>;
    expect(Object.values(article)).not.toContain(doc.sorttitle);
  });

  it("strips the doi: prefix from elocationid", () => {
    expect(formatSummaryArticle("1", doc).doi).toBe("10.1056/NEJMoa123456");
  });

  it("extracts a 4-digit year from a free-text pubdate", () => {
    expect(formatSummaryArticle("1", { ...doc, pubdate: "2019 Dec" }).year).toBe("2019");
  });

  it("falls back to the abbreviated source when fulljournalname is absent", () => {
    const { fulljournalname, ...rest } = doc;
    void fulljournalname;
    expect(formatSummaryArticle("1", rest).journal).toBe("N Engl J Med");
  });

  it("degrades gracefully on an empty document", () => {
    expect(formatSummaryArticle("1", {})).toEqual({
      pmid: "1",
      title: "",
      authors: [],
      journal: "",
      year: "",
      doi: "",
    });
  });
});
