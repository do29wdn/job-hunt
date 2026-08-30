export type NormalizedJob = {
  id: string; // fingerprint: company|title|location
  source: string;
  externalId?: string;
  title: string;
  company: string;
  location?: string;
  description?: string;
  url: string;
  employmentType?: string;
  postedAt?: string; // ISO
  firstSeenAt: string; // ISO
  rawTitle?: string;
  salary?: string;
  isWatchlist?: boolean;
};

export type RawJob = {
  source: string;
  externalId?: string;
  title: string;
  company: string;
  location?: string;
  description?: string;
  url: string;
  employmentType?: string;
  postedAt?: string;
  salary?: string;
};

export type ScoredJob = NormalizedJob & {
  score: number; // 0-100
  reasons: string[];
  gaps: string[];
  matchedSkills: string[];
  aiExplanation?: string;
  visaSupport?: string;
};

export type PipelineResult = {
  totalFetched: number;
  afterNormalize: number;
  afterFilter: number;
  afterDedupe: number;
  newJobs: number;
  scored: ScoredJob[];
};

export interface JobSource {
  name: string;
  fetchJobs(): Promise<RawJob[]>;
}
