import type { NormalizedJob } from "../types.js";
import { jaccard, levenshtein, bloomHash } from "./ds.js";

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

function titleSimilarity(a: string, b: string): number {
  const lev = levenshtein(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  const levSim = maxLen === 0 ? 1 : 1 - lev / maxLen;
  return Math.max(levSim, jaccard(a, b));
}

export function dedupe(jobs: NormalizedJob[]): { unique: NormalizedJob[]; duplicates: NormalizedJob[] } {
  // Prefer watchlist + higher score: sort so watchlist comes first
  const sorted = [...jobs].sort((a, b) => Number(!!(b as any).isWatchlist) - Number(!!(a as any).isWatchlist));
  const seenFingerprints = new Set<string>();
  const seenUrls = new Set<string>();
  const seenExternalIds = new Set<string>();
  const seenBloom = new Set<string>();
  const unique: NormalizedJob[] = [];
  const duplicates: NormalizedJob[] = [];

  for (const job of sorted) {
    const fp = job.id;
    const url = normUrl(job.url);
    const eid = job.externalId ? `${job.source}:${job.externalId}` : null;
    const bloomKeys = bloomHash(fp).join("|");

    const dupFp = seenFingerprints.has(fp);
    const dupUrl = seenUrls.has(url);
    const dupEid = eid ? seenExternalIds.has(eid) : false;
    const dupBloom = seenBloom.has(bloomKeys);

    // Fuzzy dedupe: if same company and title similarity >0.85 and location Jaccard >0.6, treat as duplicate
    let fuzzyDup = false;
    if (!dupFp && !dupUrl && !dupEid) {
      for (const u of unique) {
        if (u.company.toLowerCase() === job.company.toLowerCase()) {
          const sim = titleSimilarity(u.title, job.title);
          const locSim = jaccard(u.location ?? "", job.location ?? "");
          if (sim > 0.88 && locSim > 0.5) {
            fuzzyDup = true;
            break;
          }
          // also check if titles are very close via Levenshtein
          if (levenshtein(u.title.toLowerCase(), job.title.toLowerCase()) <= 2 && u.title.length > 10) {
            fuzzyDup = true;
            break;
          }
        }
      }
    }

    if (dupFp || dupUrl || dupEid || dupBloom || fuzzyDup) {
      duplicates.push(job);
      continue;
    }
    seenFingerprints.add(fp);
    seenUrls.add(url);
    if (eid) seenExternalIds.add(eid);
    seenBloom.add(bloomKeys);
    unique.push(job);
  }
  return { unique, duplicates };
}
