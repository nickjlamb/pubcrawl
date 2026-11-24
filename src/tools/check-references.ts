import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cache, TTL } from "../lib/cache.js";
import { efetch, esummary, pmidToPmcid } from "../lib/ncbi.js";
import { getCrossrefWork, doiIsRegistered, searchCrossref } from "../lib/crossref.js";
import { statusFromSummary, type PublicationStatus } from "../lib/publication-status.js";
import { parseXml, extractText } from "../lib/xml-parser.js";
import {
  parseJatsReferences,
  compareReference,
  recordFromSummary,
  recordFromCrossref,
  citationLine,
  type ParsedReference,
} from "../lib/references.js";
import { pmidFromArticleMeta } from "./fulltext.js";
import type { NotCheckedReason, ReferenceCheck, ReferenceCheckResult } from "../types.js";

const schema = {
  pmid: z.string().optional().describe("PubMed ID of the paper whose reference list to check"),
  pmcid: z.string().optional().describe("PubMed Central ID of the paper (e.g., PMC1234567)"),
  include: z
    .enum(["flagged", "all"])
    .default("flagged")
    .describe("flagged: list only references that did not resolve or cite a retracted article. all: list every reference."),
};

/** PubMed accepts many IDs per esummary call; this keeps each URL well within limits. */
const PMID_BATCH = 150;
/** Most Crossref and doi.org requests one call may make, so a very long list cannot run for minutes. */
export const MAX_EXTERNAL_LOOKUPS = 150;

export const RESULT_NOTE =
  "not_found means no matching record was found in PubMed or Crossref for the reference as cited. " +
  "It is not proof that the reference was fabricated: books, reports, non-English journals and typing " +
  "errors can fail for ordinary reasons. Check each flagged reference by hand. not_checked references " +
  "were not verified and must not be read as clean.";

/** The network calls the check needs. Injected so the logic is tested without a network. */
export interface ReferenceLookups {
  /** esummary documents keyed by PMID. */
  pubmedSummaries: (pmids: string[]) => Promise<Record<string, unknown>>;
  /** The Crossref work for a DOI, or null when Crossref has none. */
  crossrefWork: (doi: string) => Promise<Record<string, unknown> | null>;
  doiIsRegistered: (doi: string) => Promise<boolean>;
  searchCrossref: (citation: string) => Promise<Record<string, unknown>[]>;
}

/** A record's title for an issue line: no closing full stop (PubMed adds one), at most 120 characters. */
function shorten(title: string): string {
  const plain = title.replace(/\.$/, "");
  return plain.length > 120 ? `${plain.slice(0, 117)}...` : plain;
}

function base(ref: ParsedReference): Pick<ReferenceCheck, "n" | "label" | "citation" | "pmid" | "doi"> {
  return {
    n: ref.n,
    ...(ref.label && { label: ref.label }),
    citation: citationLine(ref),
    ...(ref.pmid && { pmid: ref.pmid }),
    ...(ref.doi && { doi: ref.doi }),
  };
}

function notChecked(ref: ParsedReference, reason: NotCheckedReason, detail: string, issues: string[]): ReferenceCheck {
  return {
    ...base(ref),
    status: "not_checked",
    detail,
    not_checked_reason: reason,
    ...(issues.length > 0 && { issues }),
    retracted: null,
  };
}

/**
 * Check every reference against the record its identifiers point to.
 *
 * Order of evidence for one reference: its PMID (one batched PubMed call for the
 * whole list), then its DOI at Crossref, then, only if an identifier turned out to
 * be wrong, a Crossref search for the cited title (a second pass, one at a time). A failed lookup never becomes a
 * verdict: the reference is reported as not_checked.
 */
export async function checkReferences(
  refs: ParsedReference[],
  lookups: ReferenceLookups,
  maxExternalLookups = MAX_EXTERNAL_LOOKUPS,
): Promise<ReferenceCheck[]> {
  const pmids = [...new Set(refs.map((r) => r.pmid).filter(Boolean))];
  const summaries: Record<string, unknown> = {};
  const failedPmids = new Set<string>();
  for (let i = 0; i < pmids.length; i += PMID_BATCH) {
    const batch = pmids.slice(i, i + PMID_BATCH);
    try {
      Object.assign(summaries, await lookups.pubmedSummaries(batch));
    } catch {
      for (const pmid of batch) failedPmids.add(pmid);
    }
  }

  let externalLookups = 0;
  const takeLookup = (): boolean => {
    if (externalLookups >= maxExternalLookups) return false;
    externalLookups += 1;
    return true;
  };

  async function checkOne(ref: ParsedReference): Promise<ReferenceCheck | { ref: ParsedReference; issues: string[] }> {
    if (!ref.pmid && !ref.doi) {
      return notChecked(ref, "no_identifier", "The reference has no PMID or DOI, so there was nothing to look up.", []);
    }

    const issues: string[] = [];
    let mismatch = false; // an identifier is known to be wrong
    let limitReached = false;
    let doiElsewhere = false;

    if (ref.pmid) {
      if (failedPmids.has(ref.pmid)) {
        issues.push(`PMID ${ref.pmid} could not be looked up (PubMed did not answer).`);
      } else {
        const doc = summaries[ref.pmid];
        const record = recordFromSummary(ref.pmid, doc);
        if (!record) {
          mismatch = true;
          issues.push(`PMID ${ref.pmid} is not in PubMed.`);
        } else {
          const result = compareReference(ref, record);
          if (result.match) {
            const status: PublicationStatus = statusFromSummary(doc as Record<string, unknown>);
            return {
              ...base(ref),
              status: "resolved",
              detail:
                result.on === "title"
                  ? "PMID resolves to a PubMed record with a matching title."
                  : "PMID resolves to a PubMed record with the same year, first author and volume or page (titles differ, as with a translated title).",
              matched_by: "pmid",
              retracted: status.retracted,
              ...(status.warning !== undefined && { warning: status.warning }),
            };
          }
          mismatch = true;
          issues.push(`PMID ${ref.pmid} is a different record: "${shorten(record.titles[0] ?? "")}".`);
        }
      }
    }

    if (ref.doi) {
      if (!takeLookup()) {
        limitReached = true;
      } else {
        try {
          const work = await lookups.crossrefWork(ref.doi);
          const record = work ? recordFromCrossref(work) : null;
          if (record) {
            const result = compareReference(ref, record);
            if (result.match) {
              return {
                ...base(ref),
                status: "resolved",
                detail: "DOI resolves to a Crossref record that matches the citation.",
                matched_by: "doi",
                ...(issues.length > 0 && { issues }),
                retracted: null,
              };
            }
            mismatch = true;
            issues.push(`DOI ${ref.doi} is a different work: "${shorten(record.titles[0] ?? "")}".`);
          } else if (!takeLookup()) {
            limitReached = true;
          } else if (await lookups.doiIsRegistered(ref.doi)) {
            doiElsewhere = true;
            issues.push(`DOI ${ref.doi} exists but is registered outside Crossref, so its title could not be compared.`);
          } else {
            mismatch = true;
            issues.push(`DOI ${ref.doi} is not a registered DOI.`);
          }
        } catch {
          issues.push(`DOI ${ref.doi} could not be looked up (Crossref or doi.org did not answer).`);
        }
      }
    }

    if (!mismatch) {
      if (doiElsewhere) {
        return notChecked(ref, "doi_outside_crossref", "The DOI exists, but its record could not be compared with the citation.", issues);
      }
      if (limitReached) {
        return notChecked(ref, "lookup_limit", "Not looked up: this call reached its limit on external lookups.", issues);
      }
      return notChecked(ref, "lookup_failed", "A lookup failed, so this reference could not be checked.", issues);
    }

    // An identifier is wrong. Whether the cited work exists under its title is
    // settled in a second pass, once every identifier lookup has finished.
    return { ref, issues };
  }

  /** Second pass for a reference whose identifier is wrong: search Crossref for its title. */
  async function searchFor(ref: ParsedReference, issues: string[]): Promise<ReferenceCheck> {
    if (!takeLookup()) {
      return notChecked(ref, "lookup_limit", "An identifier did not match, and the title search was skipped: this call reached its limit on external lookups.", issues);
    }
    try {
      const query = ref.title ? [ref.title, ref.first_author, ref.year].filter(Boolean).join(" ") : ref.text;
      for (const work of await lookups.searchCrossref(query)) {
        const record = recordFromCrossref(work);
        if (record && compareReference(ref, record).match) {
          return {
            ...base(ref),
            status: "wrong_identifier",
            detail: "The identifier given does not match the citation, but a work with this title exists.",
            issues,
            found: { doi: record.doi, title: record.titles[0] ?? "" },
            retracted: null,
          };
        }
      }
    } catch {
      return notChecked(ref, "lookup_failed", "An identifier did not match, and the title search failed.", issues);
    }
    return {
      ...base(ref),
      status: "not_found",
      detail: "The identifier given does not match the citation, and no work with this title was found in Crossref.",
      issues,
      retracted: null,
    };
  }

  // Searches run one at a time, after the identifier lookups: Crossref limits
  // searches far more tightly, and refuses them while DOI lookups are in flight.
  const firstPass = await Promise.all(refs.map(checkOne));
  const checks: ReferenceCheck[] = [];
  for (const outcome of firstPass) {
    checks.push("status" in outcome ? outcome : await searchFor(outcome.ref, outcome.issues));
  }
  return checks;
}

/** Counts by status and by not-checked reason. */
export function summariseChecks(checks: ReferenceCheck[]): Pick<ReferenceCheckResult, "summary" | "not_checked_reasons"> {
  const summary = { resolved: 0, wrong_identifier: 0, not_found: 0, not_checked: 0, retracted_references: 0 };
  const reasons: Partial<Record<NotCheckedReason, number>> = {};
  for (const check of checks) {
    summary[check.status] += 1;
    if (check.retracted === true) summary.retracted_references += 1;
    if (check.not_checked_reason) reasons[check.not_checked_reason] = (reasons[check.not_checked_reason] ?? 0) + 1;
  }
  return { summary, ...(Object.keys(reasons).length > 0 && { not_checked_reasons: reasons }) };
}

/** A reference a reader should look at: it did not resolve, or it cites a retracted or flagged article. */
export function isFlagged(check: ReferenceCheck): boolean {
  return check.status === "wrong_identifier" || check.status === "not_found" || check.retracted === true || check.warning !== undefined;
}

const liveLookups: ReferenceLookups = {
  pubmedSummaries: (pmids) => esummary({ id: pmids }),
  crossrefWork: getCrossrefWork,
  doiIsRegistered,
  searchCrossref: (citation) => searchCrossref(citation),
};

export function registerCheckReferencesTool(server: McpServer): void {
  server.tool(
    "check_references",
    "Check the reference list of an open-access paper in PubMed Central. Looks up each reference's PMID and DOI and reports which resolve to a matching record, which carry a wrong identifier, and which match nothing (not_found). Also flags cited articles that PubMed marks as retracted. not_found is a prompt to check by hand, not proof of fabrication. References without a PMID or DOI are reported as not_checked. Only works for papers available in PMC.",
    schema,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (params) => {
      try {
        if (!params.pmid && !params.pmcid) {
          return {
            content: [{ type: "text", text: "Either pmid or pmcid is required" }],
            isError: true,
          };
        }

        let pmcid = params.pmcid ?? null;
        const pmid = params.pmid ?? "";
        if (!pmcid && pmid) {
          pmcid = await pmidToPmcid(pmid);
          if (!pmcid) {
            return {
              content: [{
                type: "text",
                text: `No PMC full text available for PMID ${pmid}, so its reference list cannot be read. The article may not be open access.`,
              }],
              isError: true,
            };
          }
        }
        pmcid = `PMC${pmcid!.replace(/^PMC/i, "")}`;

        const cacheKey = `check_references:${pmcid}`;
        let full = cache.get<ReferenceCheckResult>(cacheKey);
        if (!full) {
          const xml = await efetch({ db: "pmc", id: pmcid.slice(3), rettype: "xml" });
          const parsed = parseXml(xml);
          const found = parsed["pmc-articleset"]?.article ?? parsed.article;
          const article = Array.isArray(found) ? found[0] : found;
          if (!article) {
            return {
              content: [{ type: "text", text: `Could not parse the PMC record for ${pmcid}` }],
              isError: true,
            };
          }

          const articleMeta = article.front?.["article-meta"];
          const title = articleMeta?.["title-group"]?.["article-title"]
            ? extractText(articleMeta["title-group"]["article-title"])
            : "";
          const refs = parseJatsReferences(article.back);
          const checks = await checkReferences(refs, liveLookups);

          // The paper's own retraction status, as get_full_text reports it: null when it could not be checked.
          const statusPmid = pmid || pmidFromArticleMeta(articleMeta);
          let status: PublicationStatus | null = null;
          if (statusPmid) {
            try {
              const summary = await esummary({ id: [statusPmid] });
              const doc = summary[statusPmid] as Record<string, unknown> | undefined;
              if (doc && !doc.error) status = statusFromSummary(doc);
            } catch {
              status = null;
            }
          }

          full = {
            pmid: statusPmid,
            pmcid,
            title,
            retracted: status ? status.retracted : null,
            ...(status?.warning !== undefined && { warning: status.warning }),
            ...(status?.notices !== undefined && { notices: status.notices }),
            reference_count: refs.length,
            ...summariseChecks(checks),
            listed: "all",
            references: checks,
            note: RESULT_NOTE,
          };
          // Only a complete check is worth keeping: a failed lookup may succeed next time.
          const reasons = full.not_checked_reasons ?? {};
          if (!reasons.lookup_failed && !reasons.lookup_limit) cache.set(cacheKey, full, TTL.SUMMARY);
        }

        const result: ReferenceCheckResult =
          params.include === "all"
            ? full
            : { ...full, listed: "flagged", references: full.references.filter(isFlagged) };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error checking references: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
