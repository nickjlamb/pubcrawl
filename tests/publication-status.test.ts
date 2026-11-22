import { describe, expect, it } from "vitest";
import {
  buildPublicationStatus,
  statusFromEuropePmc,
  statusFromPubmedXml,
  statusFromSummary,
} from "../src/lib/publication-status.js";
import { parseXml } from "../src/lib/xml-parser.js";
import { formatSummaryArticle } from "../src/lib/pubmed-format.js";
import { formatEuropePmcResult } from "../src/lib/europepmc.js";
import { pmidFromArticleMeta } from "../src/tools/fulltext.js";

// Fixtures are trimmed copies of live responses (2026-11-22) for three PubMed records:
//   9500320  — retracted article with two retraction notices and an expression of concern
//   20137807 — the retraction notice itself
//   28467925 — an ordinary article with one erratum
const RETRACTION_2004 = "Lancet. 2004 Mar 6;363(9411):750. doi: 10.1016/S0140-6736(04)15715-2.";
const RETRACTION_2010 = "Lancet. 2010 Feb 6;375(9713):445. doi: 10.1016/S0140-6736(10)60175-4.";
const CONCERN_2011 = "Eur J Gastroenterol Hepatol. 2011 Nov;23(11):1082. doi: 10.1097/MEG.0b013e328349d184.";
const ERRATUM_2019 = "Cell Metab. 2019 Sep 3;30(3):607. doi: 10.1016/j.cmet.2019.08.002.";

const summaryRetracted = {
  title: "Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children.",
  pubtype: ["Journal Article", "Research Support, Non-U.S. Gov't", "Retracted Publication"],
  references: [
    { refsource: "Lancet. 1998 Feb 28;351(9103):611-2.", reftype: "Comment in", pmid: 9500313, note: "" },
    { refsource: RETRACTION_2004, reftype: "Retraction in", pmid: 15016483, note: "" },
    { refsource: RETRACTION_2010, reftype: "Retraction in", pmid: 20137807, note: "" },
    { refsource: CONCERN_2011, reftype: "Expression of concern in", pmid: 21971344, note: "" },
  ],
};
const summaryNotice = {
  title: "Retraction--Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children.",
  pubtype: ["Retraction Notice"],
  references: [
    { refsource: "Lancet. 1998 Feb 28;351(9103):637-41.", reftype: "Retraction of", pmid: 9500320, note: "" },
  ],
};
const summaryErratum = {
  title: "Gut Microbiome-Based Metagenomic Signature for Non-invasive Detection of Advanced Fibrosis.",
  pubtype: ["Journal Article"],
  references: [
    { refsource: "Hepatology. 2017 Dec;66(6):2080-2083.", reftype: "Comment in", pmid: 28732121, note: "" },
    { refsource: ERRATUM_2019, reftype: "Erratum in", pmid: 31484056, note: "" },
  ],
};

const xmlRetracted = `<PubmedArticleSet><PubmedArticle><MedlineCitation>
  <PMID Version="1">9500320</PMID>
  <Article><ArticleTitle>Ileal-lymphoid-nodular hyperplasia.</ArticleTitle>
    <PublicationTypeList>
      <PublicationType UI="D016428">Journal Article</PublicationType>
      <PublicationType UI="D016441">Retracted Publication</PublicationType>
    </PublicationTypeList></Article>
  <CommentsCorrectionsList>
    <CommentsCorrections RefType="CommentIn"><RefSource>Lancet. 1998 Feb 28;351(9103):611-2.</RefSource><PMID Version="1">9500313</PMID></CommentsCorrections>
    <CommentsCorrections RefType="RetractionIn"><RefSource>${RETRACTION_2004}</RefSource><PMID Version="1">15016483</PMID></CommentsCorrections>
    <CommentsCorrections RefType="RetractionIn"><RefSource>${RETRACTION_2010}</RefSource><PMID Version="1">20137807</PMID></CommentsCorrections>
    <CommentsCorrections RefType="ExpressionOfConcernIn"><RefSource>${CONCERN_2011}</RefSource><PMID Version="1">21971344</PMID></CommentsCorrections>
  </CommentsCorrectionsList>
</MedlineCitation></PubmedArticle></PubmedArticleSet>`;

// One publication type and one correction: fast-xml-parser yields objects here, not arrays.
const xmlSingleErratum = `<PubmedArticleSet><PubmedArticle><MedlineCitation>
  <Article><PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType></PublicationTypeList></Article>
  <CommentsCorrectionsList>
    <CommentsCorrections RefType="ErratumIn"><RefSource>${ERRATUM_2019}</RefSource><PMID Version="1">31484056</PMID></CommentsCorrections>
  </CommentsCorrectionsList>
</MedlineCitation></PubmedArticle></PubmedArticleSet>`;

const epmcRetracted = {
  id: "9500320",
  source: "MED",
  pmid: "9500320",
  title: "Ileal-lymphoid-nodular hyperplasia.",
  pubTypeList: { pubType: ["Retracted Publication", "Research Support, Non-U.S. Gov't", "Journal Article"] },
  commentCorrectionList: {
    commentCorrection: [
      { source: "MED", id: "9500313", reference: "Lancet. 1998 Feb 28;351(9103):611-2.", type: "Comment in", orderIn: 1 },
      { source: "MED", id: "15016483", reference: RETRACTION_2004.replace(/\.$/, ""), type: "Retraction in", orderIn: 23 },
      { source: "MED", id: "20137807", reference: RETRACTION_2010.replace(/\.$/, ""), type: "Retraction in", orderIn: 28 },
      { source: "MED", id: "21971344", reference: CONCERN_2011.replace(/\.$/, ""), type: "Expression of concern in", orderIn: 29 },
    ],
  },
};

const firstArticle = (xml: string) => parseXml(xml).PubmedArticleSet.PubmedArticle[0];

describe("statusFromSummary (esummary JSON)", () => {
  it("flags a retracted article and cites every notice", () => {
    const status = statusFromSummary(summaryRetracted);
    expect(status.retracted).toBe(true);
    expect(status.notices).toEqual([
      { type: "retraction", pmid: "15016483", reference: RETRACTION_2004 },
      { type: "retraction", pmid: "20137807", reference: RETRACTION_2010 },
      { type: "expression_of_concern", pmid: "21971344", reference: CONCERN_2011 },
    ]);
    expect(status.warning).toMatch(/^RETRACTED: this article has been retracted\. Notice: Lancet\. 2004/);
    expect(status.warning).toContain("(PMID 20137807)");
    expect(status.warning).toContain("EXPRESSION OF CONCERN");
    expect(status.warning).toContain("(PMID 21971344)");
  });

  it("identifies a retraction notice as a notice, not as a retracted article", () => {
    const status = statusFromSummary(summaryNotice);
    expect(status).toEqual({
      retracted: false,
      warning: "RETRACTION NOTICE: this record is a retraction notice, not a research article. It concerns PMID 9500320.",
    });
  });

  it("lists an erratum without raising a warning", () => {
    expect(statusFromSummary(summaryErratum)).toEqual({
      retracted: false,
      notices: [{ type: "erratum", pmid: "31484056", reference: ERRATUM_2019 }],
    });
  });

  it("reports a clean article as exactly { retracted: false }", () => {
    expect(statusFromSummary({ pubtype: ["Journal Article", "Randomized Controlled Trial"], references: [] })).toEqual({
      retracted: false,
    });
    expect(statusFromSummary({})).toEqual({ retracted: false });
    expect(statusFromSummary({ pubtype: "", references: null })).toEqual({ retracted: false });
  });
});

describe("statusFromPubmedXml (efetch XML)", () => {
  it("matches the esummary result for the same retracted article", () => {
    expect(statusFromPubmedXml(firstArticle(xmlRetracted))).toEqual(statusFromSummary(summaryRetracted));
  });

  it("handles a single publication type and a single correction", () => {
    expect(statusFromPubmedXml(firstArticle(xmlSingleErratum))).toEqual({
      retracted: false,
      notices: [{ type: "erratum", pmid: "31484056", reference: ERRATUM_2019 }],
    });
  });

  it("is clean for a record with no corrections list", () => {
    expect(statusFromPubmedXml({ MedlineCitation: { Article: {} } })).toEqual({ retracted: false });
    expect(statusFromPubmedXml(undefined)).toEqual({ retracted: false });
  });
});

describe("statusFromEuropePmc (core result)", () => {
  it("flags the same article from Europe PMC's fields", () => {
    const status = statusFromEuropePmc(epmcRetracted);
    expect(status.retracted).toBe(true);
    expect(status.notices?.map((n) => [n.type, n.pmid])).toEqual([
      ["retraction", "15016483"],
      ["retraction", "20137807"],
      ["expression_of_concern", "21971344"],
    ]);
    expect(status.warning).toContain("RETRACTED");
  });

  it("does not present a non-MEDLINE id as a PMID", () => {
    const status = statusFromEuropePmc({
      pubTypeList: { pubType: "Journal Article" },
      commentCorrectionList: {
        commentCorrection: [{ source: "PPR", id: "PPR12345", reference: "bioRxiv 2024", type: "Erratum in" }],
      },
    });
    expect(status.notices).toEqual([{ type: "erratum", pmid: "", reference: "bioRxiv 2024" }]);
  });

  it("is clean for a preprint with no corrections", () => {
    expect(statusFromEuropePmc({ source: "PPR", pubTypeList: { pubType: ["Preprint"] } })).toEqual({ retracted: false });
  });
});

describe("buildPublicationStatus", () => {
  it("treats the publication type alone as retracted, with no notice to cite", () => {
    expect(buildPublicationStatus(["Retracted Publication"], [])).toEqual({
      retracted: true,
      warning: "RETRACTED: this article has been retracted.",
    });
  });

  it("treats a retraction link alone as retracted", () => {
    const status = buildPublicationStatus(["Journal Article"], [{ type: "Retraction in", pmid: "1", reference: "J. 2020." }]);
    expect(status.retracted).toBe(true);
    expect(status.warning).toBe("RETRACTED: this article has been retracted. Notice: J. 2020 (PMID 1).");
  });

  it("reports a partial retraction without marking the article retracted", () => {
    const status = buildPublicationStatus([], [{ type: "PartialRetractionIn", pmid: "2", reference: "J. 2021." }]);
    expect(status.retracted).toBe(false);
    expect(status.notices).toEqual([{ type: "partial_retraction", pmid: "2", reference: "J. 2021." }]);
    expect(status.warning).toMatch(/^PARTIALLY RETRACTED/);
  });

  it("maps both spellings of a republication link and ignores unrelated links", () => {
    const status = buildPublicationStatus(
      [],
      [
        { type: "RepublishedIn", pmid: "3", reference: "A." },
        { type: "Corrected and republished in", pmid: "4", reference: "B." },
        { type: "Comment in", pmid: "5", reference: "C." },
        { type: "Update in", pmid: "6", reference: "D." },
        { type: "Erratum for", pmid: "7", reference: "E." },
      ],
    );
    expect(status).toEqual({
      retracted: false,
      notices: [
        { type: "corrected_and_republished", pmid: "3", reference: "A." },
        { type: "corrected_and_republished", pmid: "4", reference: "B." },
      ],
    });
  });

  it("drops duplicate notices", () => {
    const link = { type: "Retraction in", pmid: "1", reference: "J. 2020." };
    expect(buildPublicationStatus([], [link, { ...link }]).notices).toHaveLength(1);
  });

  it("identifies an expression-of-concern record", () => {
    const status = buildPublicationStatus(["Expression of Concern"], [{ type: "Expression of concern for", pmid: "9", reference: "X." }]);
    expect(status).toEqual({
      retracted: false,
      warning: "EXPRESSION OF CONCERN NOTICE: this record is an expression of concern, not a research article. It concerns PMID 9.",
    });
  });
});

describe("tool result shapes", () => {
  it("search results put retracted and warning straight after the title", () => {
    const article = formatSummaryArticle("9500320", summaryRetracted);
    expect(Object.keys(article).slice(0, 5)).toEqual(["pmid", "title", "retracted", "warning", "notices"]);
    expect(article.retracted).toBe(true);
  });

  it("a clean search result gains only `retracted: false`", () => {
    const article = formatSummaryArticle("1", { title: "T", pubtype: ["Journal Article"] });
    expect(article.retracted).toBe(false);
    expect("warning" in article).toBe(false);
    expect("notices" in article).toBe(false);
  });

  it("Europe PMC results carry the same fields", () => {
    const article = formatEuropePmcResult(epmcRetracted);
    expect(article.retracted).toBe(true);
    expect(article.warning).toContain("RETRACTED");
    expect(article.notices).toHaveLength(3);
    expect(formatEuropePmcResult({ id: "1", source: "MED" }).retracted).toBe(false);
  });
});

describe("pmidFromArticleMeta (JATS)", () => {
  it("finds the PMID among several article ids", () => {
    const xml = `<article><front><article-meta>
      <article-id pub-id-type="pmc">7102549</article-id>
      <article-id pub-id-type="pmid">32205204</article-id>
      <article-id pub-id-type="doi">10.1016/j.ijantimicag.2020.105949</article-id>
    </article-meta></front></article>`;
    expect(pmidFromArticleMeta(parseXml(xml).article.front["article-meta"])).toBe("32205204");
  });

  it("returns an empty string when there is no PMID", () => {
    const xml = `<article><front><article-meta><article-id pub-id-type="pmc">1</article-id></article-meta></front></article>`;
    expect(pmidFromArticleMeta(parseXml(xml).article.front["article-meta"])).toBe("");
    expect(pmidFromArticleMeta(undefined)).toBe("");
  });
});
