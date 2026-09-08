export type NormalizedJob = {
    id: string;
    source: string;
    externalId?: string;
    title: string;
    company: string;
    location?: string;
    description?: string;
    url: string;
    employmentType?: string;
    postedAt?: string;
    firstSeenAt: string;
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
    isWatchlist?: boolean;
};
export type ScoredJob = NormalizedJob & {
    score: number;
    reasons: string[];
    gaps: string[];
    matchedSkills: string[];
    aiExplanation?: string;
    visaSupport?: string;
};
export interface JobSource {
    name: string;
    fetchJobs(): Promise<RawJob[]>;
}
