import type { NormalizedJob, RawJob } from "../types.js";
function slug(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
export function fingerprint(job: Pick<NormalizedJob, "company" | "title" | "location">): string {
    return `${slug(job.company)}|${slug(job.title)}|${slug(job.location ?? "")}`;
}
export function normalize(raw: RawJob): NormalizedJob | null {
    if (!raw.title || !raw.company || !raw.url)
        return null;
    return {
        id: fingerprint({ company: raw.company, title: raw.title, location: raw.location }),
        source: raw.source,
        externalId: raw.externalId,
        title: raw.title.trim(),
        company: raw.company.trim(),
        location: raw.location?.trim(),
        description: raw.description?.trim().slice(0, 8000),
        url: raw.url.trim(),
        employmentType: raw.employmentType,
        postedAt: raw.postedAt,
        firstSeenAt: new Date().toISOString(),
        salary: raw.salary,
        isWatchlist: raw.isWatchlist ?? raw.source.includes("watchlist"),
    };
}
export function normalizeMany(rawJobs: RawJob[]): NormalizedJob[] {
    const out: NormalizedJob[] = [];
    for (const r of rawJobs) {
        const n = normalize(r);
        if (n)
            out.push(n);
    }
    return out;
}
