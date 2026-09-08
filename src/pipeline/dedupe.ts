import type { NormalizedJob } from "../types.js";
import { jaccard, levenshtein } from "./ds.js";
export type DedupeStrategy = "company_title_location" | "url" | "both";
function normUrl(url: string): string {
    try {
        const u = new URL(url);
        u.search = "";
        u.hash = "";
        return u.toString().replace(/\/$/, "").toLowerCase();
    }
    catch {
        return url.trim().toLowerCase();
    }
}
function titleSimilarity(a: string, b: string): number {
    const lev = levenshtein(a.toLowerCase(), b.toLowerCase());
    const maxLen = Math.max(a.length, b.length);
    const levSim = maxLen === 0 ? 1 : 1 - lev / maxLen;
    return Math.max(levSim, jaccard(a, b));
}
function locationCompatible(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b)
        return true;
    return jaccard(a, b) > 0.5;
}
export function dedupe(jobs: NormalizedJob[], strategy: DedupeStrategy = "both"): {
    unique: NormalizedJob[];
    duplicates: NormalizedJob[];
} {
    const useFp = strategy !== "url";
    const useUrl = strategy !== "company_title_location";
    const sorted = [...jobs].sort((a, b) => Number(!!b.isWatchlist) - Number(!!a.isWatchlist));
    const seenFingerprints = new Set<string>();
    const seenUrls = new Set<string>();
    const seenExternalIds = new Set<string>();
    const byCompany = new Map<string, NormalizedJob[]>();
    const unique: NormalizedJob[] = [];
    const duplicates: NormalizedJob[] = [];
    for (const job of sorted) {
        const fp = job.id;
        const url = normUrl(job.url);
        const eid = job.externalId ? `${job.source}:${job.externalId}` : null;
        const dupFp = useFp && seenFingerprints.has(fp);
        const dupUrl = useUrl && seenUrls.has(url);
        const dupEid = useUrl && eid !== null && seenExternalIds.has(eid);
        let fuzzyDup = false;
        if (useFp && !dupFp && !dupUrl && !dupEid) {
            const bucket = byCompany.get(job.company.toLowerCase());
            if (bucket) {
                for (const u of bucket) {
                    if (!locationCompatible(u.location, job.location))
                        continue;
                    if (titleSimilarity(u.title, job.title) > 0.88) {
                        fuzzyDup = true;
                        break;
                    }
                    if (u.title.length > 10 && levenshtein(u.title.toLowerCase(), job.title.toLowerCase()) <= 2) {
                        fuzzyDup = true;
                        break;
                    }
                }
            }
        }
        if (dupFp || dupUrl || dupEid || fuzzyDup) {
            duplicates.push(job);
            continue;
        }
        if (useFp) {
            seenFingerprints.add(fp);
            const key = job.company.toLowerCase();
            if (!byCompany.has(key))
                byCompany.set(key, []);
            byCompany.get(key)!.push(job);
        }
        if (useUrl) {
            seenUrls.add(url);
            if (eid)
                seenExternalIds.add(eid);
        }
        unique.push(job);
    }
    return { unique, duplicates };
}
