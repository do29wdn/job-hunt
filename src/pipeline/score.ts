import type { NormalizedJob, ScoredJob } from "../types.js";
import type { AppConfig } from "../config.js";
import { AhoCorasick, fuzzyMatch, levenshtein, MaxHeap } from "./ds.js";

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// Cache automata per config key
const acCache = new Map<string, AhoCorasick>();
function getAc(patterns: string[], key: string): AhoCorasick {
  const k = key + ":" + patterns.join("|");
  if (!acCache.has(k)) acCache.set(k, new AhoCorasick(patterns));
  return acCache.get(k)!;
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

  // Role match +40 — exact + fuzzy (Levenshtein <=2) via pattern recognition
  const allRoles = [...cfg.roles, ...cfg.roleAliases];
  let roleMatch = false;
  let fuzzyRole: string | null = null;
  for (const r of allRoles) {
    if (includesCI(title, r)) { roleMatch = true; break; }
  }
  if (!roleMatch) {
    for (const r of allRoles) {
      if (fuzzyMatch(title, r, 2)) { fuzzyRole = r; break; }
    }
  }
  if (roleMatch) {
    score += cfg.weights.roleMatch;
    reasons.push("Role title matches preferences");
  } else if (fuzzyRole) {
    score += Math.round(cfg.weights.roleMatch * 0.85);
    reasons.push(`Fuzzy role match: ${fuzzyRole}`);
  } else if (/engineer|developer/.test(title)) {
    score += Math.round(cfg.weights.roleMatch * 0.5);
    reasons.push("Generic engineer/developer title");
  }

  // Strong skill match +30 (proportional) — Aho-Corasick multi-pattern O(n)
  const acStrong = getAc(cfg.strongSkills, "strong");
  const acAll = getAc(cfg.skills, "all");
  const strongHitsSet = acStrong.search(combined);
  const allHitsSet = acAll.search(combined);
  const strongHits = [...strongHitsSet];
  const allSkillHits = [...allHitsSet];
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

  // Visa / sponsorship signals (abroad)
  const visaPositive = ["visa sponsorship", "sponsor", "global payroll", "relocation", "work permit", "h1b", "eu blue card"];
  const visaNegative = ["us citizen only", "security clearance", "citizenship required", "no sponsorship"];
  if (visaPositive.some((k) => includesCI(combined, k) || includesCI(loc, k))) {
    score += 5;
    reasons.push("Visa/sponsorship mentioned");
    (job as any).visaSupport = "Visa support mentioned";
  }
  if (visaNegative.some((k) => includesCI(combined, k))) {
    score -= 10;
    gaps.push("Citizenship/clearance required — likely no sponsorship");
    (job as any).visaSupport = "No sponsorship";
  }

  // Timezone / IST overlap bonus
  if (includesCI(combined, "ist") || includesCI(combined, "india time") || includesCI(loc, "ist")) {
    score += 3;
    reasons.push("IST overlap mentioned");
  }
  if (includesCI(combined, "async") || includesCI(combined, "flexible hours")) {
    score += 2;
    reasons.push("Async/flexible hours");
  }

  // Salary hints (extract if present)
  const salaryMatch = combined.match(/(\$|€|£|₹)\s?[\d,]+(?:\s?k)?(?:\s?-\s?(\$|€|£|₹)?\s?[\d,]+k?)?/i) || combined.match(/(\d+)\s*(usd|eur|inr)/i);
  if (salaryMatch) {
    (job as any).salary = salaryMatch[0].slice(0, 80);
    reasons.push(`Compensation: ${(job as any).salary}`);
  }

  // Watchlist bonus (+10, capped)
  if ((job as any).isWatchlist) {
    score += 10;
    reasons.push("⭐ Watchlist company");
  }

  score = Math.max(0, Math.min(100, score));

  return { ...job, score, reasons, gaps, matchedSkills } as ScoredJob;
}

export function scoreMany(jobs: NormalizedJob[], cfg: AppConfig): ScoredJob[] {
  const scored = jobs.map((j) => scoreJob(j, cfg));
  // Multi-criteria sort: score ↓, watchlist ↑, recency ↓, company ↑ (stable)
  // Use heap for top-K efficiency, but still sort fully for report determinism
  // Heavy DS: MaxHeap O(n log k) for topK, plus stable sort
  const heap = new MaxHeap<ScoredJob>((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const aWl = (a as any).isWatchlist ? 1 : 0;
    const bWl = (b as any).isWatchlist ? 1 : 0;
    if (aWl !== bWl) return aWl - bWl;
    const aTime = a.postedAt ? new Date(a.postedAt).getTime() : 0;
    const bTime = b.postedAt ? new Date(b.postedAt).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.company.localeCompare(b.company);
  });
  for (const s of scored) heap.push(s);
  // For full list, return stable sort (deterministic)
  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aWl = (a as any).isWatchlist ? 1 : 0;
    const bWl = (b as any).isWatchlist ? 1 : 0;
    if (bWl !== aWl) return bWl - aWl;
    const aTime = a.postedAt ? new Date(a.postedAt).getTime() : 0;
    const bTime = b.postedAt ? new Date(b.postedAt).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return a.title.localeCompare(b.title);
  });
}
