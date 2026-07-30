import { describe, it, expect } from "vitest";
import {
  formatApa,
  formatVancouver,
  formatHarvard,
  formatBibtex,
  ArticleInfo,
} from "../src/tools/cite.js";

const base: ArticleInfo = {
  authors: ["Smith Jane", "Doe John"],
  title: "A study of everything",
  journal: "Journal of Testing",
  year: "2023",
  volume: "12",
  issue: "4",
  pages: "100-110",
  doi: "10.1000/xyz",
  pmid: "12345678",
};

describe("formatApa", () => {
  it("renders authors, year, title, journal and DOI", () => {
    const out = formatApa(base);
    expect(out).toBe(
      "Smith, J., Doe, J. (2023). A study of everything. *Journal of Testing*, *12*(4), 100-110. https://doi.org/10.1000/xyz"
    );
  });

  it("truncates long author lists with an ellipsis and final author", () => {
    const many = { ...base, authors: Array.from({ length: 9 }, (_, i) => `Author${i} First${i}`) };
    const out = formatApa(many);
    expect(out).toContain("...");
    expect(out).toContain("Author8, F.");
  });
});

describe("formatVancouver", () => {
  it("uses concatenated initials and semicolon volume", () => {
    const out = formatVancouver(base);
    expect(out).toBe(
      "Smith J, Doe J. A study of everything. Journal of Testing. 2023;12(4):100-110. doi:10.1000/xyz"
    );
  });

  it("appends 'et al' beyond six authors", () => {
    const many = { ...base, authors: Array.from({ length: 7 }, (_, i) => `Auth${i} F${i}`) };
    expect(formatVancouver(many)).toContain(", et al");
  });
});

describe("formatHarvard", () => {
  it("wraps the title in quotes and italicises the journal", () => {
    const out = formatHarvard(base);
    expect(out).toContain("'A study of everything'.");
    expect(out).toContain("*Journal of Testing*");
    expect(out).toContain("pp. 100-110");
  });

  it("collapses to 'et al.' beyond three authors", () => {
    const many = { ...base, authors: ["A One", "B Two", "C Three", "D Four"] };
    expect(formatHarvard(many)).toContain("et al.");
  });
});

describe("formatBibtex", () => {
  it("builds a citation key from first-author surname + year", () => {
    const out = formatBibtex(base);
    expect(out).toContain("@article{smith2023,");
    expect(out).toContain("author  = {Smith, Jane and Doe, John}");
    expect(out).toContain("doi     = {10.1000/xyz}");
    expect(out).toContain("pmid    = {12345678}");
  });

  it("omits optional fields when empty", () => {
    const sparse = { ...base, volume: "", issue: "", pages: "", doi: "" };
    const out = formatBibtex(sparse);
    expect(out).not.toContain("volume");
    expect(out).not.toContain("doi");
  });
});
