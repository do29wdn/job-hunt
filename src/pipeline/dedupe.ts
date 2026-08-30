import type { NormalizedJob } from "../types.js";

function normUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function dedupe(jobs: NormalizedJob[]): { unique: NormalizedJob[]; duplicates: NormalizedJob[] } {
  // Prefer watchlist jobs: sort so watchlist comes first, then dedupe keeps watchlist version
  const sorted = [...jobs].sort((a, b) => Number(!!(b as any).isWatchlist) - Number(!!(a as any).isWatchlist));
  const seenFingerprints = new Set<string>();
  const seenUrls = new Set<string>();
  const seenExternalIds = new Set<string>();
  const unique: NormalizedJob[] = [];
  const duplicates: NormalizedJob[] = [];

  for (const job of sorted) {
    const fp = job.id;
    const url = normUrl(job.url);
    const eid = job.externalId ? `${job.source}:${job.externalId}` : null;

    const dupFp = seenFingerprints.has(fp);
    const dupUrl = seenUrls.has(url);
    const dupEid = eid ? seenExternalIds.has(eid) : false;

    if (dupFp || dupUrl || dupEid) {
      duplicates.push(job);
      continue;
    }
    seenFingerprints.add(fp);
    seenUrls.add(url);
    if (eid) seenExternalIds.add(eid);
    unique.push(job);
  }
  return { unique, duplicates };
}
