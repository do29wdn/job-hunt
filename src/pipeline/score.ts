import type { NormalizedJob, ScoredJob } from "../types.js";
import type { AppConfig } from "../config.js";

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function scoreJob(job: NormalizedJob, cfg: AppConfig): ScoredJob {
  let score = 0;
  const reasons: string[] = [];
  const gaps: string[] = [];
  const matchedSkills: string[] = [];

  const title = job.title.toLowerCase();
  const desc = (job.description ?? "").toLowerCase();
  const loc = (job.location ?? "").toLowerCase();
  const combined = `${title} ${desc}`;

  // Role match +40
  const roleMatch = [...cfg.roles, ...cfg.roleAliases].some((r) => includesCI(title, r));
  if (roleMatch) {
    score += cfg.weights.roleMatch;
    reasons.push("Role title matches preferences");
  } else if (/engineer|developer/.test(title)) {
    score += Math.round(cfg.weights.roleMatch * 0.5);
    reasons.push("Generic engineer/developer title");
  }

  // Strong skill match +30 (proportional)
  const strongHits = cfg.strongSkills.filter((s) => includesCI(combined, s));
  const allSkillHits = cfg.skills.filter((s) => includesCI(combined, s));
  matchedSkills.push(...Array.from(new Set([...strongHits, ...allSkillHits])));

  if (strongHits.length > 0) {
    const ratio = Math.min(strongHits.length / 3, 1); // 1 hit=10, 3+=30
    const pts = Math.round(cfg.weights.strongSkill * ratio);
    score += pts;
    reasons.push(`Strong skills: ${strongHits.join(", ")}`);
  } else if (allSkillHits.length >= 2) {
    score += Math.round(cfg.weights.strongSkill * 0.5);
    reasons.push(`Skills: ${allSkillHits.slice(0, 3).join(", ")}`);
  } else if (allSkillHits.length === 0) {
    gaps.push("No preferred stack mentioned");
  }

  // Location +15 / Remote +10
  const isPreferredLoc = cfg.preferredLocations.some((p) => includesCI(loc, p));
  if (isPreferredLoc) {
    // if remote india/pune etc
    score += cfg.weights.location;
    reasons.push(`Preferred location: ${job.location}`);
  } else if (includesCI(loc, "remote") && cfg.remoteGlobalAllowed) {
    score += cfg.weights.remote;
    reasons.push("Remote (global)");
  } else if (includesCI(loc, "india")) {
    score += Math.round(cfg.weights.location * 0.7);
    reasons.push("India location");
  }

  // Recency +5
  if (job.postedAt) {
    const posted = new Date(job.postedAt).getTime();
    const ageDays = (Date.now() - posted) / (1000 * 60 * 60 * 24);
    if (ageDays <= 7) {
      score += cfg.weights.recency;
      reasons.push("Recently posted");
    } else if (ageDays > 30) {
      score -= 5;
      gaps.push("Posted >30 days ago");
    }
  }

  // Seniority down-score (not hard filter, already filtered blocklist)
  const yearsMatch = combined.match(/(\d+)\+?\s*years/);
  if (yearsMatch) {
    const yrs = parseInt(yearsMatch[1], 10);
    if (yrs >= cfg.seniorYearsThreshold) {
      score -= 15;
      gaps.push(`Requires ${yrs}+ years`);
    }
  }
  if (/staff|principal|architect/.test(combined) && /engineer/.test(title)) {
    score -= 10;
    gaps.push("Senior-level hints");
  }

  // Missing strong skills gaps
  const missingStrong = cfg.strongSkills.filter((s) => !includesCI(combined, s));
  if (missingStrong.length >= 3 && strongHits.length <= 1) {
    gaps.push(`Missing: ${missingStrong.slice(0, 2).join(", ")}`);
  }

  score = Math.max(0, Math.min(100, score));

  return { ...job, score, reasons, gaps, matchedSkills };
}

export function scoreMany(jobs: NormalizedJob[], cfg: AppConfig): ScoredJob[] {
  return jobs
    .map((j) => scoreJob(j, cfg))
    .sort((a, b) => b.score - a.score);
}
