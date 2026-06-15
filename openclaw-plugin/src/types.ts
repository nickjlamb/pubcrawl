export interface PubMedArticle {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  year: string;
  doi: string;
  abstract_snippet: string;
}

export interface AbstractSection {
  label: string;
  text: string;
}

export interface FullAbstract {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  year: string;
  doi: string;
  volume: string;
  issue: string;
  pages: string;
  abstract_sections: AbstractSection[];
  keywords: string[];
  mesh_terms: string[];
  pmc_id: string;
}

export interface FullTextSection {
  title: string;
  content: string;
}

export interface FullTextResult {
  pmid: string;
  pmcid: string;
  title: string;
  sections: FullTextSection[];
  figure_captions: string[];
  table_captions: string[];
  reference_count: number;
}

export interface RelatedArticle extends PubMedArticle {
  relevance_score: number;
}

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

// Drug labelling types

export interface LabelSection {
  code: string;
  title: string;
  content: string;
}

export interface USPIResult {
  drug_name: string;
  setid: string;
  spl_version: string;
  published_date: string;
  sections: LabelSection[];
  dailymed_url: string;
}

export interface SmPCResult {
  drug_name: string;
  product_id: string;
  sections: LabelSection[];
  url: string;
}

export interface LabelComparison {
  topic: string;
  us_section: LabelSection | null;
  uk_section: LabelSection | null;
}

export interface CompareLabelsResult {
  drug: string;
  comparisons: LabelComparison[];
  us_source: string | null;
  uk_source: string | null;
}

export interface DrugApprovalEntry {
  name: string;
  brand_name?: string;
  manufacturer?: string;
  us_approved: boolean;
  uk_approved: boolean;
  us_setid?: string;
  uk_product_id?: string;
}

export interface IndicationSearchResult {
  condition: string;
  drugs: DrugApprovalEntry[];
}

// Clinical trials types

export interface TrialIntervention {
  type: string;
  name: string;
}

export interface ClinicalTrialSummary {
  nct_id: string;
  title: string;
  status: string;
  phase: string;
  conditions: string[];
  interventions: TrialIntervention[];
  enrollment: number | null;
  sponsor: string;
  start_date: string;
  completion_date: string;
  study_type: string;
  url: string;
}

export interface TrialOutcome {
  measure: string;
  description: string;
  time_frame: string;
}

export interface TrialArmGroup {
  label: string;
  type: string;
  description: string;
  intervention_names: string[];
}

export interface TrialDesign {
  allocation: string;
  intervention_model: string;
  primary_purpose: string;
  masking: string;
  who_masked: string[];
}

export interface ClinicalTrialDetail extends ClinicalTrialSummary {
  official_title: string;
  summary: string;
  eligibility: {
    criteria: string;
    gender: string;
    minimum_age: string;
    maximum_age: string;
    healthy_volunteers: string;
  };
  design: TrialDesign;
  arms: TrialArmGroup[];
  primary_outcomes: TrialOutcome[];
  secondary_outcomes: TrialOutcome[];
  locations_count: number;
  lead_investigator: string;
  associated_pmids: string[];
  url: string;
}
