import type { NormalizedJob } from "../types.js";
import type { AppConfig } from "../config.js";

export type FilterResult = {
  kept: NormalizedJob[];
  dropped: Array<{ job: NormalizedJob; reason: string }>;
};

function containsAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

function isSeniorBlocked(job: NormalizedJob, cfg: AppConfig): string | null {
  const text = `${job.title} ${job.description ?? ""}`.toLowerCase();
  for (const blocked of cfg.seniorityBlocklist) {
    if (text.includes(blocked.toLowerCase())) {
      // allow "associate" or "junior" overrides? keep simple: block if explicitly senior title
      // but don't block if title is "software engineer" and description merely mentions "work with principal engineers"
      // So we primarily check TITLE for blocklist
      if (job.title.toLowerCase().includes(blocked.toLowerCase())) {
        return `seniority blocklist: ${blocked}`;
      }
    }
  }
  return null;
}

function isRoleRelevant(job: NormalizedJob, cfg: AppConfig): boolean {
  const title = job.title.toLowerCase();
  const desc = (job.description ?? "").toLowerCase();
  const allRoleKeywords = [...cfg.roles, ...cfg.roleAliases].map((s) => s.toLowerCase());

  // direct role match in title
  if (allRoleKeywords.some((k) => title.includes(k))) return true;

  // fallback: if title contains generic but skills heavy, keep (e.g., "Web Engineer")
  // already covered by aliases, but also check description for role-like terms
  // if description mentions react/node/typescript strongly, be lenient
  const skillHits = cfg.skills.filter((s) => desc.includes(s.toLowerCase())).length;
  if (skillHits >= 3 && /engineer|developer/.test(title)) return true;

  return false;
}

function isLocationRelevant(job: NormalizedJob, cfg: AppConfig): boolean {
  if (!job.location) return true; // don't drop if missing
  const loc = job.location.toLowerCase();
  if (cfg.preferredLocations.some((p) => loc.includes(p.toLowerCase()))) return true;
  if (cfg.remoteGlobalAllowed && loc.includes("remote")) return true;
  // allow "india" anywhere
  if (loc.includes("india")) return true;
  return false;
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
