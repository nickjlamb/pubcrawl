import { describe, it, expect } from "vitest";
import {
  parseXml,
  extractText,
  parseAuthors,
  parseSummaryAuthors,
  parseAbstractSections,
  parseMeshTerms,
  parseKeywords,
  parseJatsSections,
  parseFigureCaptions,
  parseTableCaptions,
  countReferences,
  parseSplSections,
} from "../src/lib/xml-parser.js";

describe("extractText", () => {
  it("returns strings and numbers verbatim", () => {
    expect(extractText("hello")).toBe("hello");
    expect(extractText(42)).toBe("42");
  });

  it("returns empty string for null/undefined", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("reads the #text node of an object", () => {
    expect(extractText({ "#text": "body", "@_id": "x" })).toBe("body");
  });

  it("concatenates child text while ignoring attributes", () => {
    const node = { b: "bold", i: "italic", "@_class": "skip" };
    expect(extractText(node)).toBe("bold italic");
  });
});

describe("parseAuthors (efetch XML shape)", () => {
  it("formats LastName + ForeName", () => {
    const authorList = {
      Author: [
        { LastName: "Smith", ForeName: "Jane" },
        { LastName: "Doe", ForeName: "John" },
      ],
    };
    expect(parseAuthors(authorList)).toEqual(["Smith Jane", "Doe John"]);
  });

  it("falls back to initials when ForeName is absent", () => {
    const authorList = { Author: { LastName: "Smith", Initials: "J" } };
    expect(parseAuthors(authorList)).toEqual(["Smith J"]);
  });

  it("uses CollectiveName for group authors", () => {
    const authorList = { Author: [{ CollectiveName: "The GENIE Consortium" }] };
    expect(parseAuthors(authorList)).toEqual(["The GENIE Consortium"]);
  });

  it("returns [] for missing input", () => {
    expect(parseAuthors(undefined)).toEqual([]);
    expect(parseAuthors(null)).toEqual([]);
  });
});

describe("parseSummaryAuthors (esummary JSON shape)", () => {
  it("reads the name property", () => {
    const authors = [{ name: "Smith J" }, { name: "Doe J" }];
    expect(parseSummaryAuthors(authors)).toEqual(["Smith J", "Doe J"]);
  });

  it("handles a single (non-array) author", () => {
    expect(parseSummaryAuthors({ name: "Solo A" })).toEqual(["Solo A"]);
  });

  it("returns [] for missing input", () => {
    expect(parseSummaryAuthors(undefined)).toEqual([]);
  });
});

describe("parseAbstractSections", () => {
  it("preserves labelled structured-abstract sections", () => {
    const node = {
      AbstractText: [
        { "@_Label": "BACKGROUND", "#text": "Context here." },
        { "@_Label": "METHODS", "#text": "We did things." },
      ],
    };
    expect(parseAbstractSections(node)).toEqual([
      { label: "BACKGROUND", text: "Context here." },
      { label: "METHODS", text: "We did things." },
    ]);
  });

  it("handles a plain unlabelled abstract string", () => {
    const node = { AbstractText: "A single flat abstract." };
    expect(parseAbstractSections(node)).toEqual([
      { label: "", text: "A single flat abstract." },
    ]);
  });

  it("returns [] when there is no abstract", () => {
    expect(parseAbstractSections({})).toEqual([]);
    expect(parseAbstractSections(undefined)).toEqual([]);
  });
});

describe("parseMeshTerms & parseKeywords", () => {
  it("extracts MeSH descriptor names", () => {
    const meshList = {
      MeshHeading: [
        { DescriptorName: { "#text": "Neoplasms", "@_UI": "D009369" } },
        { DescriptorName: "Humans" },
      ],
    };
    expect(parseMeshTerms(meshList)).toEqual(["Neoplasms", "Humans"]);
  });

  it("extracts keyword text", () => {
    const kwList = { Keyword: ["oncology", "biomarker"] };
    expect(parseKeywords(kwList)).toEqual(["oncology", "biomarker"]);
  });
});

describe("JATS full-text parsing", () => {
  const body = {
    sec: [
      {
        title: "Introduction",
        p: ["First paragraph.", "Second paragraph."],
      },
      {
        title: "Methods",
        p: "Only paragraph.",
        sec: [{ title: "Sub", p: "Nested paragraph." }],
      },
    ],
  };

  it("parses sections with titles and joined paragraphs", () => {
    const sections = parseJatsSections(body);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Introduction");
    expect(sections[0].content).toContain("First paragraph.");
    expect(sections[0].content).toContain("Second paragraph.");
  });

  it("includes nested subsection content", () => {
    const sections = parseJatsSections(body);
    expect(sections[1].content).toContain("Nested paragraph.");
  });

  it("counts references anywhere in the back matter", () => {
    const back = { "ref-list": { ref: [{ id: "1" }, { id: "2" }, { id: "3" }] } };
    expect(countReferences(back)).toBe(3);
    expect(countReferences(undefined)).toBe(0);
  });

  it("extracts figure and table captions with labels", () => {
    const withMedia = {
      sec: {
        fig: { label: "Figure 1", caption: "A chart." },
        "table-wrap": { label: "Table 1", caption: "A table." },
      },
    };
    expect(parseFigureCaptions(withMedia)).toEqual(["Figure 1: A chart."]);
    expect(parseTableCaptions(withMedia)).toEqual(["Table 1: A table."]);
  });
});

describe("parseSplSections (DailyMed / FDA label)", () => {
  const structuredBody = {
    component: [
      {
        section: [
          {
            code: { "@_code": "34067-9" },
            title: "INDICATIONS AND USAGE",
            text: { paragraph: ["Indicated for X.", "Also Y."] },
          },
          {
            code: { "@_code": "34071-1" },
            title: "WARNINGS",
            text: { paragraph: "Do not use if Z." },
          },
        ],
      },
    ],
  };

  it("extracts all sections with LOINC code, title and joined content", () => {
    const sections = parseSplSections(structuredBody);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ code: "34067-9", title: "INDICATIONS AND USAGE" });
    expect(sections[0].content).toContain("Indicated for X.");
    expect(sections[0].content).toContain("Also Y.");
  });

  it("filters to requested LOINC codes when provided", () => {
    const sections = parseSplSections(structuredBody, ["34071-1"]);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("WARNINGS");
  });

  it("returns [] for empty input", () => {
    expect(parseSplSections(undefined)).toEqual([]);
  });
});

describe("parseXml isArray behaviour", () => {
  it("coerces repeatable elements to arrays even when singular", () => {
    const parsed = parseXml(
      "<PubmedArticleSet><PubmedArticle><x>1</x></PubmedArticle></PubmedArticleSet>"
    );
    expect(Array.isArray(parsed.PubmedArticleSet.PubmedArticle)).toBe(true);
  });
});
