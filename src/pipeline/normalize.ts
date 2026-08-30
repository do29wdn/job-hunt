import type { NormalizedJob, RawJob } from "../types.js";

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9\s]/g, "");
}

export function fingerprint(job: Pick<NormalizedJob, "company" | "title" | "location">): string {
  const c = slug(job.company);
  const t = slug(job.title);
  const l = slug(job.location ?? "");
  return `${c}|${t}|${l}`;
}

export function normalize(raw: RawJob): NormalizedJob | null {
  if (!raw.title || !raw.company || !raw.url) return null;
  const now = new Date().toISOString();
  const id = fingerprint({ company: raw.company, title: raw.title, location: raw.location });
  return {
    id,
    source: raw.source,
    externalId: raw.externalId,
    title: raw.title.trim(),
    company: raw.company.trim(),
    location: raw.location?.trim(),
    description: raw.description?.trim().slice(0, 8000),
    url: raw.url.trim(),
    employmentType: raw.employmentType,
    postedAt: raw.postedAt,
    firstSeenAt: now,
    rawTitle: raw.title,
  };
}

export function normalizeMany(rawJobs: RawJob[]): NormalizedJob[] {
  const out: NormalizedJob[] = [];
  for (const r of rawJobs) {
    const n = normalize(r);
    if (n) out.push(n);
  }
  return out;
}
