import { describe, it, expect } from "vitest";
import { parseXml } from "../src/lib/xml-parser.js";
import {
  parseJatsReferences,
  normaliseDoi,
  titleTokens,
  titleSimilarity,
  textCoverage,
  compareReference,
  recordFromSummary,
  recordFromCrossref,
  citationLine,
  type ParsedReference,
  type CandidateRecord,
} from "../src/lib/references.js";

// The reference shapes PMC serves: a structured element-citation, an unstructured
// mixed-citation with the DOI only in its text, a citation-alternatives pair, a
// web page with no identifier, and a ref holding an original and a translated copy.
const BACK = `<back><ref-list>
  <ref id="bib1"><label>1</label><element-citation publication-type="journal">
    <person-group person-group-type="author">
      <name><surname>Arendt</surname><given-names>T.</given-names></name>
      <name><surname>Stieler</surname><given-names>J.T.</given-names></name>
    </person-group>
    <article-title>Tau and tauopathies</article-title><source>Brain Res. Bull.</source>
    <volume>126</volume><year>2016</year><fpage>238</fpage><lpage>292</lpage>
    <pub-id pub-id-type="doi">10.1016/j.brainresbull.2016.08.018</pub-id>
    <pub-id pub-id-type="pmid">27615390</pub-id>
  </element-citation></ref>
  <ref id="CR47"><label>47</label><mixed-citation publication-type="other">Rinne, J. et al. Internalization of novel delivery vector TAT-streptavidin into human cells. <italic>Mol. Ther.</italic> <bold>13</bold>, S73 (2006). 10.1016/j.ymthe.2006.08.212.</mixed-citation></ref>
  <ref id="CR2"><label>2</label><citation-alternatives>
    <element-citation publication-type="journal">
      <person-group person-group-type="author"><name><surname>Maksimovic</surname><given-names>N</given-names></name><etal/></person-group>
      <article-title>Incidence and mortality patterns of acute myeloid leukemia in Belgrade, Serbia (1999–2013)</article-title>
      <source>Med</source><year>2018</year><volume>54</volume><fpage>5</fpage>
    </element-citation>
    <mixed-citation>Maksimovic, N. et al. <pub-id pub-id-type="doi">10.3390/medicina54010005</pub-id> <pub-id pub-id-type="pmid">30344236</pub-id></mixed-citation>
  </citation-alternatives></ref>
  <ref id="r1"><mixed-citation publication-type="eref"><collab>Centers for Disease Control and Prevention</collab>. COVID-19 information page.</mixed-citation></ref>
  <ref id="b9"><label>9</label>
    <element-citation publication-type="journal"><person-group><name><surname>Tian</surname><given-names>YW</given-names></name></person-group>
      <article-title>Relations of epidermal growth factor receptor gene mutation</article-title><source>Zhonghua Fei Bu Ji Bing Za Zhi</source><year>2014</year><volume>7</volume><fpage>27</fpage></element-citation>
    <element-citation publication-type="journal"><article-title>Original-language title</article-title><ext-link ext-link-type="doi" xlink:href="https://doi.org/10.3760/cma.j.issn.1674-6902.2014.01.008">doi</ext-link></element-citation>
  </ref>
</ref-list></back>`;

const refs = parseJatsReferences(parseXml(BACK).back);

function ref(overrides: Partial<ParsedReference>): ParsedReference {
  return {
    n: 1, label: "", pmid: "", doi: "", title: "", text: "", first_author: "", year: "",
    source: "", volume: "", first_page: "", type: "", ...overrides,
  };
}

function record(overrides: Partial<CandidateRecord>): CandidateRecord {
  return { via: "pubmed", pmid: "", doi: "", titles: [], first_author: "", year: "", volume: "", first_page: "", ...overrides };
}

describe("parseJatsReferences", () => {
  it("returns every reference in list order", () => {
    expect(refs.map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
    expect(refs.map((r) => r.label)).toEqual(["1", "47", "2", "", "9"]);
  });

  it("reads a structured citation", () => {
    expect(refs[0]).toMatchObject({
      pmid: "27615390",
      doi: "10.1016/j.brainresbull.2016.08.018",
      title: "Tau and tauopathies",
      first_author: "Arendt",
      year: "2016",
      source: "Brain Res. Bull.",
      volume: "126",
      first_page: "238",
      type: "journal",
    });
  });

  it("finds a DOI written in the text of an unstructured citation, without its full stop", () => {
    expect(refs[1].doi).toBe("10.1016/j.ymthe.2006.08.212");
    expect(refs[1].title).toBe("");
    expect(refs[1].text).toContain("TAT-streptavidin");
  });

  it("merges citation-alternatives: title from one copy, identifiers from the other", () => {
    expect(refs[2]).toMatchObject({
      pmid: "30344236",
      doi: "10.3390/medicina54010005",
      first_author: "Maksimovic",
      year: "2018",
    });
    expect(refs[2].title).toContain("acute myeloid leukemia in Belgrade");
  });

  it("leaves identifiers empty when the reference has none", () => {
    expect(refs[3]).toMatchObject({ pmid: "", doi: "", type: "eref" });
    expect(refs[3].first_author).toBe("Centers for Disease Control and Prevention");
  });

  it("takes each field from the first copy that has it, and reads a DOI from an ext-link", () => {
    expect(refs[4].title).toBe("Relations of epidermal growth factor receptor gene mutation");
    expect(refs[4].doi).toBe("10.3760/cma.j.issn.1674-6902.2014.01.008");
  });

  it("returns an empty list for a paper with no back matter", () => {
    expect(parseJatsReferences(undefined)).toEqual([]);
    expect(parseJatsReferences({})).toEqual([]);
  });
});

describe("normaliseDoi", () => {
  it("strips resolver prefixes and trailing punctuation", () => {
    expect(normaliseDoi("https://doi.org/10.1000/abc.")).toBe("10.1000/abc");
    expect(normaliseDoi("doi: 10.1000/abc);")).toBe("10.1000/abc");
    expect(normaliseDoi("10.1016/S0140-6736(26)00603-3")).toBe("10.1016/S0140-6736(26)00603-3");
  });

  it("rejects text that is not a DOI", () => {
    expect(normaliseDoi("PMC1234567")).toBe("");
    expect(normaliseDoi("")).toBe("");
  });
});

describe("title comparison", () => {
  it("ignores case, punctuation, accents and markup", () => {
    expect(titleTokens("Häupl's <i>Tau</i>-pathology: a Review.")).toEqual(["haupl", "s", "tau", "pathology", "a", "review"]);
    expect(titleSimilarity("Tau and tauopathies.", "TAU AND TAUOPATHIES")).toBe(1);
  });

  it("ignores word order, which inline markup can change", () => {
    expect(titleSimilarity("Chronic toxicity study of extract Kaempferia parviflora", "Chronic toxicity study of Kaempferia parviflora extract")).toBe(1);
  });

  it("treats a dropped subtitle as a match when at least four words remain", () => {
    expect(titleSimilarity("Drawing nomograms with R", "Drawing Nomograms with R: applications to categorical outcome and survival data")).toBe(1);
    expect(titleSimilarity("Tau", "Tau and tauopathies in ageing")).toBeLessThan(0.7);
  });

  it("scores unrelated titles low", () => {
    expect(titleSimilarity("Tau and tauopathies", "Global cancer statistics 2020")).toBe(0);
    expect(titleSimilarity("", "Anything")).toBe(0);
  });

  it("measures how much of a title appears in an unstructured citation", () => {
    const text = "Rinne, J. et al. Internalization of novel delivery vector TAT-streptavidin into human cells. Mol. Ther. 13, S73 (2006).";
    expect(textCoverage("Internalization of Novel Delivery Vector TAT-Streptavidin into Human Cells", text)).toBe(1);
    expect(textCoverage("Global cancer statistics 2020", text)).toBe(0);
  });
});

describe("compareReference", () => {
  it("matches on title", () => {
    const result = compareReference(ref({ title: "Tau and tauopathies" }), record({ titles: ["Tau and tauopathies."] }));
    expect(result).toEqual({ match: true, on: "title", similarity: 1 });
  });

  it("matches an untitled citation when its text contains the record's title", () => {
    const cited = ref({ text: "Huang, D. et al. Quantum dynamics of attractive and repulsive polarons in a doped MoSe2 monolayer. Phys. Rev. X 13, 011029 (2023)." });
    const found = record({ titles: ["Quantum Dynamics of Attractive and Repulsive Polarons in a Doped MoSe2 Monolayer"] });
    expect(compareReference(cited, found)).toMatchObject({ match: true, on: "title" });
  });

  it("does not match a different record", () => {
    const result = compareReference(
      ref({ title: "Tau and tauopathies", first_author: "Arendt", year: "2016", volume: "126", first_page: "238" }),
      record({ titles: ["Global cancer statistics"], first_author: "Jemal", year: "2011", volume: "61", first_page: "69" }),
    );
    expect(result).toEqual({ match: false, on: null, similarity: 0 });
  });

  it("uses an alternative (vernacular) title when the main one differs", () => {
    const cited = ref({ title: "Relations of epidermal growth factor receptor gene mutation" });
    const found = record({ titles: ["[A translated title].", "Relations of epidermal growth factor receptor gene mutation"] });
    expect(compareReference(cited, found).match).toBe(true);
  });

  it("falls back to year, first author and volume or page when titles differ", () => {
    const cited = ref({ title: "Titre original en français", first_author: "Dupont", year: "2019", volume: "40", first_page: "377" });
    const translated = record({ titles: ["[An English translation of the title]."], first_author: "Dupont", year: "2019", volume: "40", first_page: "377" });
    expect(compareReference(cited, translated)).toMatchObject({ match: true, on: "bibliographic" });
  });

  it("does not use the bibliographic fallback on year and author alone", () => {
    const cited = ref({ title: "One paper", first_author: "Smith", year: "2019", volume: "12", first_page: "100" });
    const other = record({ titles: ["Another paper entirely"], first_author: "Smith", year: "2019", volume: "40", first_page: "377" });
    expect(compareReference(cited, other).match).toBe(false);
  });
});

describe("recordFromSummary", () => {
  const doc = {
    uid: "27615390",
    title: "Tau and tauopathies.",
    vernaculartitle: "",
    authors: [{ name: "Arendt T" }, { name: "Stieler JT" }],
    pubdate: "2016 Sep",
    volume: "126",
    pages: "238-292",
    articleids: [{ idtype: "pubmed", value: "27615390" }, { idtype: "doi", value: "10.1016/j.brainresbull.2016.08.018" }],
  };

  it("maps an esummary document", () => {
    expect(recordFromSummary("27615390", doc)).toEqual({
      via: "pubmed",
      pmid: "27615390",
      doi: "10.1016/j.brainresbull.2016.08.018",
      titles: ["Tau and tauopathies."],
      first_author: "Arendt",
      year: "2016",
      volume: "126",
      first_page: "238",
    });
  });

  it("returns null for a PMID PubMed does not have", () => {
    expect(recordFromSummary("99999999", { uid: "99999999", error: "cannot get document summary" })).toBeNull();
    expect(recordFromSummary("99999999", undefined)).toBeNull();
  });
});

describe("recordFromCrossref", () => {
  it("maps a Crossref work, adding the title with its subtitle", () => {
    const work = {
      DOI: "10.21037/atm.2017.04.01",
      title: ["Drawing Nomograms with R"],
      subtitle: ["applications to categorical outcome and survival data"],
      author: [{ family: "Zhang", given: "Zhongheng" }],
      issued: { "date-parts": [[2017, 5]] },
      volume: "5",
      page: "211-211",
    };
    expect(recordFromCrossref(work)).toEqual({
      via: "crossref",
      pmid: "",
      doi: "10.21037/atm.2017.04.01",
      titles: [
        "Drawing Nomograms with R",
        "applications to categorical outcome and survival data",
        "Drawing Nomograms with R applications to categorical outcome and survival data",
      ],
      first_author: "Zhang",
      year: "2017",
      volume: "5",
      first_page: "211",
    });
  });

  it("returns null for an empty work", () => {
    expect(recordFromCrossref({})).toBeNull();
    expect(recordFromCrossref(null)).toBeNull();
  });
});

describe("citationLine", () => {
  it("gives author, year, title and source for a structured reference", () => {
    expect(citationLine(refs[0])).toBe("Arendt 2016. Tau and tauopathies. Brain Res. Bull.");
  });

  it("gives the citation text when no title is marked up, shortened to one line", () => {
    expect(citationLine(refs[1])).toContain("Rinne, J. et al.");
    expect(citationLine(ref({ text: "x".repeat(300) }))).toHaveLength(160);
  });
});
