import type { NormalizedJob } from "../types.js";
import type { AppConfig } from "../config.js";
export type FilterResult = {
    kept: NormalizedJob[];
    dropped: Array<{
        job: NormalizedJob;
        reason: string;
    }>;
};
export type LocationTier = "preferred" | "india" | "remote-global" | "none";
export function locationTier(location: string | undefined, cfg: AppConfig): LocationTier {
    if (!location)
        return "none";
    const l = location.toLowerCase();
    const specific = cfg.preferredLocations.filter((p) => p.toLowerCase() !== "remote");
    if (specific.some((p) => l.includes(p.toLowerCase())))
        return "preferred";
    if (l.includes("india"))
        return "india";
    if (cfg.remoteGlobalAllowed && l.includes("remote"))
        return "remote-global";
    return "none";
}
function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isSeniorBlocked(job: NormalizedJob, cfg: AppConfig): string | null {
    const title = job.title.toLowerCase();
    for (const blocked of cfg.seniorityBlocklist) {
        const b = blocked.toLowerCase().trim();
        if (!b)
            continue;
        const re = new RegExp(`\\b${escapeRe(b)}\\b`);
        if (re.test(title)) {
            return `seniority blocklist: ${blocked}`;
        }
    }
    return null;
}
function isRoleRelevant(job: NormalizedJob, cfg: AppConfig): boolean {
    const title = job.title.toLowerCase();
    const desc = (job.description ?? "").toLowerCase();
    const allRoleKeywords = [...cfg.roles, ...cfg.roleAliases].map((s) => s.toLowerCase());
    if (allRoleKeywords.some((k) => title.includes(k)))
        return true;
    const strongHits = cfg.strongSkills.filter((s) => desc.includes(s.toLowerCase())).length;
    if (strongHits >= 2 && /engineer|developer/.test(title))
        return true;
    return false;
}
function isLocationRelevant(job: NormalizedJob, cfg: AppConfig): boolean {
    if (!job.location)
        return true;
    return locationTier(job.location, cfg) !== "none";
}
export function filterJobs(jobs: NormalizedJob[], cfg: AppConfig): FilterResult {
    const kept: NormalizedJob[] = [];
    const dropped: FilterResult["dropped"] = [];
    for (const job of jobs) {
        const seniorReason = isSeniorBlocked(job, cfg);
        if (seniorReason) {
            dropped.push({ job, reason: seniorReason });
            continue;
        }
        if (job.isWatchlist) {
            kept.push(job);
            continue;
        }
        if (!isRoleRelevant(job, cfg)) {
            dropped.push({ job, reason: "role not relevant" });
            continue;
        }
        if (!isLocationRelevant(job, cfg)) {
            dropped.push({ job, reason: `location not preferred: ${job.location}` });
            continue;
        }
        kept.push(job);
    }
    return { kept, dropped };
}
