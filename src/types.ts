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
