import { describe, it, expect } from "vitest";
import { parseEuropePmcFullText } from "../src/lib/europepmc.js";

// A trimmed Europe PMC `fullTextXML` payload (JATS — same shape PMC returns).
const jats = `
<article>
  <front>
    <article-meta>
      <title-group>
        <article-title>A Preprint on GLP-1 Signalling</article-title>
      </title-group>
    </article-meta>
  </front>
  <body>
    <sec>
      <title>Introduction</title>
      <p>GLP-1 is important.</p>
      <p>We study it here.</p>
    </sec>
    <sec>
      <title>Methods</title>
      <p>We ran experiments.</p>
      <fig><label>Figure 1</label><caption>Study design.</caption></fig>
    </sec>
    <sec>
      <title>Results</title>
      <p>It worked.</p>
      <table-wrap><label>Table 1</label><caption>Summary of results.</caption></table-wrap>
    </sec>
  </body>
  <back>
    <ref-list>
      <ref id="r1"/>
      <ref id="r2"/>
      <ref id="r3"/>
    </ref-list>
  </back>
</article>`;

describe("parseEuropePmcFullText", () => {
  it("extracts the article title from the JATS front matter", () => {
    const ft = parseEuropePmcFullText(jats, "PPR", "PPR123456");
    expect(ft.title).toBe("A Preprint on GLP-1 Signalling");
  });

  it("flags source PPR as a preprint (case-insensitive)", () => {
    expect(parseEuropePmcFullText(jats, "PPR", "x").is_preprint).toBe(true);
    expect(parseEuropePmcFullText(jats, "ppr", "x").is_preprint).toBe(true);
    expect(parseEuropePmcFullText(jats, "PMC", "x").is_preprint).toBe(false);
  });

  it("parses body sections with titles and joined paragraphs", () => {
    const ft = parseEuropePmcFullText(jats, "PPR", "x");
    expect(ft.sections.map((s) => s.title)).toEqual(["Introduction", "Methods", "Results"]);
    expect(ft.sections[0].content).toContain("GLP-1 is important.");
    expect(ft.sections[0].content).toContain("We study it here.");
  });

  it("extracts figure and table captions and counts references", () => {
    const ft = parseEuropePmcFullText(jats, "PPR", "x");
    expect(ft.figure_captions).toEqual(["Figure 1: Study design."]);
    expect(ft.table_captions).toEqual(["Table 1: Summary of results."]);
    expect(ft.reference_count).toBe(3);
  });

  it("filters to requested sections when a filter is given", () => {
    const ft = parseEuropePmcFullText(jats, "PPR", "x", ["methods"]);
    expect(ft.sections).toHaveLength(1);
    expect(ft.sections[0].title).toBe("Methods");
  });

  it("carries source and id through to the result", () => {
    const ft = parseEuropePmcFullText(jats, "MED", "38127654");
    expect(ft.source).toBe("MED");
    expect(ft.id).toBe("38127654");
  });

  it("degrades gracefully on a metadata-only / empty document", () => {
    const ft = parseEuropePmcFullText("<article></article>", "PPR", "x");
    expect(ft.title).toBe("");
    expect(ft.sections).toEqual([]);
    expect(ft.figure_captions).toEqual([]);
    expect(ft.reference_count).toBe(0);
  });
});
