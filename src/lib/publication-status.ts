/**
 * Retraction and correction status for an article.
 *
 * PubMed and Europe PMC both report, on the article's own record, whether it has
 * been retracted and which notices (retraction, expression of concern, erratum)
 * have been published about it. PubCrawl already fetches those records, so the
 * status costs no extra request for the search, abstract and citation tools.
 *
 * Everything here is pure: each `statusFrom*` function reads one source's raw
 * record and they all funnel into `buildPublicationStatus`, so every tool reports
 * the same shape and the same wording.
 */

export type NoticeType =
  | "retraction"
  | "partial_retraction"
  | "expression_of_concern"
  | "erratum"
  | "corrected_and_republished";

/** A notice published about the article (the notice's own record and where it appeared). */
export interface PublicationNotice {
  type: NoticeType;
  /** PMID of the notice itself; empty when the source gives none. */
  pmid: string;
  /** Where the notice was published, as the source cites it. */
  reference: string;
}

export interface PublicationStatus {
  /** True when the source marks the article as retracted in full. */
  retracted: boolean;
  /**
   * Plain-language alert, present only for the cases a reader must not miss:
   * a retraction, a partial retraction, an expression of concern, or a record that
   * is itself a retraction or expression-of-concern notice. Errata are listed in
   * `notices` without an alert.
   */
  warning?: string;
  /** Notices published about this article. Omitted when there are none. */
  notices?: PublicationNotice[];
}

/** One "comments/corrections" link exactly as a source reports it. */
export interface RawRelation {
  /** e.g. "Retraction in" (esummary, Europe PMC) or "RetractionIn" (efetch XML). */
  type: string;
  pmid: string;
  reference: string;
}

/** Links that mean "a notice was published about THIS article". */
const NOTICE_ABOUT_THIS: Record<string, NoticeType> = {
  retractionin: "retraction",
  partialretractionin: "partial_retraction",
  expressionofconcernin: "expression_of_concern",
  erratumin: "erratum",
  correctedandrepublishedin: "corrected_and_republished",
  republishedin: "corrected_and_republished",
};

/** Links that mean "THIS record is the notice", pointing at the article it is about. */
const THIS_IS_NOTICE_FOR: Record<string, NoticeType> = {
  retractionof: "retraction",
  partialretractionof: "partial_retraction",
  expressionofconcernfor: "expression_of_concern",
};

/** "Retraction in", "RetractionIn" and "retraction-in" all become "retractionin". */
function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function cite(notice: { pmid: string; reference: string }): string {
  const reference = notice.reference.trim().replace(/\.$/, "");
  if (reference && notice.pmid) return `${reference} (PMID ${notice.pmid})`;
  return reference || (notice.pmid ? `PMID ${notice.pmid}` : "");
}

function listNotices(notices: PublicationNotice[], type: NoticeType): string {
  const cited = notices.filter((n) => n.type === type).map(cite).filter(Boolean);
  return cited.length > 0 ? ` Notice: ${cited.join("; ")}.` : "";
}

/**
 * Combine a record's publication types and its comments/corrections links into one status.
 * Unrecognised types and links (comments, updates, reprints) are ignored.
 */
export function buildPublicationStatus(pubTypes: string[], relations: RawRelation[]): PublicationStatus {
  const types = new Set(pubTypes.map(key));
  const notices: PublicationNotice[] = [];
  const noticeFor: { type: NoticeType; pmid: string }[] = [];
  const seen = new Set<string>();

  for (const relation of relations) {
    const relationKey = key(relation.type);
    const about = NOTICE_ABOUT_THIS[relationKey];
    if (about) {
      const id = `${about}:${relation.pmid}:${relation.reference}`;
      if (!seen.has(id)) {
        seen.add(id);
        notices.push({ type: about, pmid: relation.pmid, reference: relation.reference.trim() });
      }
      continue;
    }
    const target = THIS_IS_NOTICE_FOR[relationKey];
    if (target) noticeFor.push({ type: target, pmid: relation.pmid });
  }

  const retracted = types.has("retractedpublication") || notices.some((n) => n.type === "retraction");
  const warnings: string[] = [];

  if (retracted) {
    warnings.push(`RETRACTED: this article has been retracted.${listNotices(notices, "retraction")}`);
  }
  if (notices.some((n) => n.type === "partial_retraction")) {
    warnings.push(
      `PARTIALLY RETRACTED: part of this article has been retracted.${listNotices(notices, "partial_retraction")}`,
    );
  }
  if (notices.some((n) => n.type === "expression_of_concern")) {
    warnings.push(
      `EXPRESSION OF CONCERN: the journal has published an expression of concern about this article.${listNotices(notices, "expression_of_concern")}`,
    );
  }

  const targets = (type: NoticeType) => {
    const pmids = noticeFor.filter((n) => n.type === type && n.pmid).map((n) => `PMID ${n.pmid}`);
    return pmids.length > 0 ? ` It concerns ${pmids.join(", ")}.` : "";
  };
  const isRetractionNotice =
    types.has("retractionofpublication") ||
    types.has("retractionnotice") ||
    noticeFor.some((n) => n.type === "retraction" || n.type === "partial_retraction");
  if (isRetractionNotice) {
    warnings.push(
      `RETRACTION NOTICE: this record is a retraction notice, not a research article.${targets("retraction")}${targets("partial_retraction")}`,
    );
  }
  const isConcernNotice =
    types.has("expressionofconcern") || noticeFor.some((n) => n.type === "expression_of_concern");
  if (isConcernNotice) {
    warnings.push(
      `EXPRESSION OF CONCERN NOTICE: this record is an expression of concern, not a research article.${targets("expression_of_concern")}`,
    );
  }

  return {
    retracted,
    ...(warnings.length > 0 && { warning: warnings.join(" ") }),
    ...(notices.length > 0 && { notices }),
  };
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

/** Text of an XML node that may be a string, a number or `{ "#text": ..., "@_attr": ... }`. */
function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return text((value as Record<string, unknown>)["#text"]);
  return String(value);
}

/** Status from one NCBI esummary document (`pubtype` and `references`). */
export function statusFromSummary(doc: Record<string, unknown>): PublicationStatus {
  const pubTypes = asArray(doc.pubtype).map(text);
  const relations = asArray(doc.references).map((entry): RawRelation => {
    const ref = (entry ?? {}) as Record<string, unknown>;
    return { type: text(ref.reftype), pmid: text(ref.pmid), reference: text(ref.refsource) };
  });
  return buildPublicationStatus(pubTypes, relations);
}

/**
 * Status from one parsed efetch `PubmedArticle` (`PublicationTypeList` and
 * `CommentsCorrectionsList`). Both can hold one element or many.
 */
export function statusFromPubmedXml(article: unknown): PublicationStatus {
  const citation = ((article ?? {}) as Record<string, unknown>).MedlineCitation as
    | Record<string, unknown>
    | undefined;
  const articleData = citation?.Article as Record<string, unknown> | undefined;
  const typeList = articleData?.PublicationTypeList as Record<string, unknown> | undefined;
  const pubTypes = asArray(typeList?.PublicationType).map(text);
  const correctionList = citation?.CommentsCorrectionsList as Record<string, unknown> | undefined;
  const relations = asArray(correctionList?.CommentsCorrections).map((entry): RawRelation => {
    const ref = (entry ?? {}) as Record<string, unknown>;
    return { type: text(ref["@_RefType"]), pmid: text(ref.PMID), reference: text(ref.RefSource) };
  });
  return buildPublicationStatus(pubTypes, relations);
}

/** Status from one Europe PMC `core` result (`pubTypeList` and `commentCorrectionList`). */
export function statusFromEuropePmc(result: Record<string, unknown>): PublicationStatus {
  const typeList = result.pubTypeList as Record<string, unknown> | undefined;
  const pubTypes = asArray(typeList?.pubType).map(text);
  const correctionList = result.commentCorrectionList as Record<string, unknown> | undefined;
  const relations = asArray(correctionList?.commentCorrection).map((entry): RawRelation => {
    const ref = (entry ?? {}) as Record<string, unknown>;
    // Europe PMC ids are PMIDs only for records from MEDLINE.
    const pmid = text(ref.source) === "MED" ? text(ref.id) : "";
    return { type: text(ref.type), pmid, reference: text(ref.reference) };
  });
  return buildPublicationStatus(pubTypes, relations);
}
