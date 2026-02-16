import { cache, TTL } from "./cache.js";
import {
  ClinicalTrialSummary,
  ClinicalTrialDetail,
  TrialIntervention,
  TrialOutcome,
  TrialArmGroup,
  TrialDesign,
} from "../types.js";

const BASE_URL = "https://clinicaltrials.gov/api/v2";
const REQUEST_DELAY_MS = 1200; // ~50 req/min
const TIMEOUT_MS = 15000;

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS - elapsed));
  }

  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`ClinicalTrials.gov API error: ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function str(value: unknown): string {
  return value != null ? String(value) : "";
}

function studyToSummary(study: Record<string, unknown>): ClinicalTrialSummary {
  const proto = study.protocolSection as Record<string, unknown> | undefined;
  if (!proto) {
    return {
      nct_id: "",
      title: "",
      status: "",
      phase: "",
      conditions: [],
      interventions: [],
      enrollment: null,
      sponsor: "",
      start_date: "",
      completion_date: "",
      study_type: "",
      url: "",
    };
  }

  const id = proto.identificationModule as Record<string, unknown> | undefined;
  const status = proto.statusModule as Record<string, unknown> | undefined;
  const design = proto.designModule as Record<string, unknown> | undefined;
  const conditions = proto.conditionsModule as Record<string, unknown> | undefined;
  const arms = proto.armsInterventionsModule as Record<string, unknown> | undefined;
  const sponsor = proto.sponsorCollaboratorsModule as Record<string, unknown> | undefined;

  const interventionList = (arms?.interventions as Array<Record<string, unknown>> | undefined) ?? [];
  const interventions: TrialIntervention[] = interventionList.map((i) => ({
    type: str(i.type),
    name: str(i.name),
  }));

  const startDateStruct = status?.startDateStruct as Record<string, unknown> | undefined;
  const completionDateStruct = status?.completionDateStruct as Record<string, unknown> | undefined;
  const enrollmentInfo = design?.enrollmentInfo as Record<string, unknown> | undefined;
  const leadSponsor = sponsor?.leadSponsor as Record<string, unknown> | undefined;

  const phases = (design?.phases as string[] | undefined) ?? [];

  const nctId = str(id?.nctId);

  return {
    nct_id: nctId,
    title: str(id?.briefTitle),
    status: str(status?.overallStatus),
    phase: phases.join("/") || "N/A",
    conditions: (conditions?.conditions as string[] | undefined) ?? [],
    interventions,
    enrollment: enrollmentInfo?.count != null ? Number(enrollmentInfo.count) : null,
    sponsor: str(leadSponsor?.name),
    start_date: str(startDateStruct?.date),
    completion_date: str(completionDateStruct?.date),
    study_type: str(design?.studyType),
    url: nctId ? `https://clinicaltrials.gov/study/${nctId}` : "",
  };
}

export async function searchTrials(params: {
  condition?: string;
  intervention?: string;
  term?: string;
  status?: string;
  phase?: string;
  maxResults?: number;
  sort?: string;
}): Promise<{ results: ClinicalTrialSummary[]; total_count: number }> {
  const cacheKey = `ct:search:${JSON.stringify(params)}`;
  const cached = cache.get<{ results: ClinicalTrialSummary[]; total_count: number }>(cacheKey);
  if (cached) return cached;

  const url = new URL(`${BASE_URL}/studies`);

  // Build query.cond / query.intr / query.term
  if (params.condition) url.searchParams.set("query.cond", params.condition);
  if (params.intervention) url.searchParams.set("query.intr", params.intervention);
  if (params.term) url.searchParams.set("query.term", params.term);

  // Filters
  if (params.status) url.searchParams.set("filter.overallStatus", params.status);
  if (params.phase) url.searchParams.set("filter.phase", params.phase);

  // Limit fields to keep payload small
  url.searchParams.set(
    "fields",
    [
      "NCTId",
      "BriefTitle",
      "OverallStatus",
      "Phase",
      "Condition",
      "InterventionName",
      "InterventionType",
      "EnrollmentCount",
      "LeadSponsorName",
      "StartDate",
      "CompletionDate",
      "StudyType",
    ].join("|")
  );

  url.searchParams.set("pageSize", String(params.maxResults ?? 10));

  // Sort
  const sortMap: Record<string, string> = {
    relevance: "",
    last_updated: "LastUpdatePostDate",
    start_date: "StudyFirstPostDate",
    enrollment: "EnrollmentCount",
  };
  const sortValue = sortMap[params.sort ?? "relevance"];
  if (sortValue) url.searchParams.set("sort", sortValue);

  url.searchParams.set("format", "json");

  const response = await rateLimitedFetch(url.toString());
  const data = await response.json();

  const studies = (data.studies as Array<Record<string, unknown>> | undefined) ?? [];
  const results = studies.map(studyToSummary);
  const totalCount = (data.totalCount as number | undefined) ?? results.length;

  const result = { results, total_count: totalCount };
  cache.set(cacheKey, result, TTL.SEARCH);
  return result;
}

export async function getTrialDetail(nctId: string): Promise<ClinicalTrialDetail> {
  const cacheKey = `ct:detail:${nctId}`;
  const cached = cache.get<ClinicalTrialDetail>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/studies/${encodeURIComponent(nctId)}?format=json`;
  const response = await rateLimitedFetch(url);
  const study = await response.json() as Record<string, unknown>;

  const summary = studyToSummary(study);
  const proto = study.protocolSection as Record<string, unknown> | undefined;

  const id = proto?.identificationModule as Record<string, unknown> | undefined;
  const desc = proto?.descriptionModule as Record<string, unknown> | undefined;
  const eligibility = proto?.eligibilityModule as Record<string, unknown> | undefined;
  const designModule = proto?.designModule as Record<string, unknown> | undefined;
  const armsModule = proto?.armsInterventionsModule as Record<string, unknown> | undefined;
  const outcomesModule = proto?.outcomesModule as Record<string, unknown> | undefined;
  const contactsModule = proto?.contactsLocationsModule as Record<string, unknown> | undefined;
  const refsModule = proto?.referencesModule as Record<string, unknown> | undefined;

  // Design info
  const designInfo = designModule?.designInfo as Record<string, unknown> | undefined;
  const maskingInfo = designInfo?.maskingInfo as Record<string, unknown> | undefined;
  const design: TrialDesign = {
    allocation: str(designInfo?.allocation),
    intervention_model: str(designInfo?.interventionModel),
    primary_purpose: str(designInfo?.primaryPurpose),
    masking: str(maskingInfo?.masking),
    who_masked: (maskingInfo?.whoMasked as string[] | undefined) ?? [],
  };

  // Arms
  const armGroups = (armsModule?.armGroups as Array<Record<string, unknown>> | undefined) ?? [];
  const arms: TrialArmGroup[] = armGroups.map((a) => ({
    label: str(a.label),
    type: str(a.type),
    description: str(a.description),
    intervention_names: (a.interventionNames as string[] | undefined) ?? [],
  }));

  // Outcomes
  const parseOutcomes = (list: unknown): TrialOutcome[] => {
    const items = (list as Array<Record<string, unknown>> | undefined) ?? [];
    return items.map((o) => ({
      measure: str(o.measure),
      description: str(o.description),
      time_frame: str(o.timeFrame),
    }));
  };

  const primaryOutcomes = parseOutcomes(outcomesModule?.primaryOutcomes);
  const secondaryOutcomes = parseOutcomes(outcomesModule?.secondaryOutcomes);

  // Locations count
  const locations = (contactsModule?.locations as unknown[] | undefined) ?? [];

  // Lead investigator
  const overallOfficials = (contactsModule?.overallOfficials as Array<Record<string, unknown>> | undefined) ?? [];
  const leadInvestigator = overallOfficials.length > 0 ? str(overallOfficials[0].name) : "";

  // Associated PMIDs
  const references = (refsModule?.references as Array<Record<string, unknown>> | undefined) ?? [];
  const pmids = references
    .map((r) => str(r.pmid))
    .filter((p) => p !== "");

  const detail: ClinicalTrialDetail = {
    ...summary,
    official_title: str(id?.officialTitle),
    summary: str(desc?.briefSummary),
    eligibility: {
      criteria: str(eligibility?.eligibilityCriteria),
      gender: str(eligibility?.sex),
      minimum_age: str(eligibility?.minimumAge),
      maximum_age: str(eligibility?.maximumAge),
      healthy_volunteers: str(eligibility?.healthyVolunteers),
    },
    design,
    arms,
    primary_outcomes: primaryOutcomes,
    secondary_outcomes: secondaryOutcomes,
    locations_count: locations.length,
    lead_investigator: leadInvestigator,
    associated_pmids: pmids,
    url: `https://clinicaltrials.gov/study/${nctId}`,
  };

  cache.set(cacheKey, detail, TTL.TRIAL);
  return detail;
}
