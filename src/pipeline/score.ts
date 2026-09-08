import type { NormalizedJob, ScoredJob } from "../types.js";
import type { AppConfig } from "../config.js";
import { AhoCorasick, fuzzyMatch } from "./ds.js";
import { includesCI } from "../utils.js";
import { locationTier } from "./filter.js";
const acCache = new Map<string, AhoCorasick>();
function getAc(patterns: string[], key: string): AhoCorasick {
    const k = key + ":" + patterns.join("|");
    if (!acCache.has(k))
        acCache.set(k, new AhoCorasick(patterns));
    return acCache.get(k)!;
}
const MIN_FUZZY_ROLE_LEN = 6;
export function scoreJob(job: NormalizedJob, cfg: AppConfig): ScoredJob {
    let score = 0;
    const reasons: string[] = [];
    const gaps: string[] = [];
    const matchedSkills: string[] = [];
    const title = job.title.toLowerCase();
    const desc = (job.description ?? "").toLowerCase();
    const loc = (job.location ?? "").toLowerCase();
    const combined = `${title} ${desc}`;
    const rawCombined = `${job.title} ${job.description ?? ""}`;
    const rawLoc = job.location ?? "";
    const allRoles = [...cfg.roles, ...cfg.roleAliases];
    let roleMatch = false;
    let fuzzyRole: string | null = null;
    for (const r of allRoles) {
        if (includesCI(title, r)) {
            roleMatch = true;
            break;
        }
    }
    if (!roleMatch) {
        for (const r of allRoles) {
            if (r.length >= MIN_FUZZY_ROLE_LEN && fuzzyMatch(title, r, 2)) {
                fuzzyRole = r;
                break;
            }
        }
    }
    if (roleMatch) {
        score += cfg.weights.roleMatch;
        reasons.push("Role title matches preferences");
    }
    else if (fuzzyRole) {
        score += Math.round(cfg.weights.roleMatch * 0.85);
        reasons.push(`Fuzzy role match: ${fuzzyRole}`);
    }
    else if (/engineer|developer/.test(title)) {
        score += Math.round(cfg.weights.roleMatch * 0.5);
        reasons.push("Generic engineer/developer title");
    }
    const acStrong = getAc(cfg.strongSkills, "strong");
    const acAll = getAc(cfg.skills, "all");
    const strongHitsSet = acStrong.search(combined);
    const allHitsSet = acAll.search(combined);
    const strongHits = [...strongHitsSet];
    const allSkillHits = [...allHitsSet];
    matchedSkills.push(...Array.from(new Set([...strongHits, ...allSkillHits])));
    if (strongHits.length > 0) {
        const ratio = Math.min(strongHits.length / 3, 1);
        const pts = Math.round(cfg.weights.strongSkill * ratio);
        score += pts;
        reasons.push(`Strong skills: ${strongHits.join(", ")}`);
    }
    else if (allSkillHits.length >= 2) {
        score += Math.round(cfg.weights.strongSkill * 0.5);
        reasons.push(`Skills: ${allSkillHits.slice(0, 3).join(", ")}`);
    }
    else if (allSkillHits.length === 0) {
        gaps.push("No preferred stack mentioned");
    }
    const tier = locationTier(job.location, cfg);
    if (tier === "preferred") {
        score += cfg.weights.location;
        reasons.push(`Preferred location: ${job.location}`);
    }
    else if (tier === "india") {
        score += Math.round(cfg.weights.location * 0.7);
        reasons.push("India location");
    }
    else if (tier === "remote-global") {
        score += cfg.weights.remote;
        reasons.push("Remote (global)");
    }
    if (job.postedAt) {
        const posted = new Date(job.postedAt).getTime();
        if (!Number.isNaN(posted)) {
            const ageDays = (Date.now() - posted) / (1000 * 60 * 60 * 24);
            if (ageDays <= 7) {
                score += cfg.weights.recency;
                reasons.push("Recently posted");
            }
            else if (ageDays > 30) {
                score -= 5;
                gaps.push("Posted >30 days ago");
            }
        }
    }
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
    const missingStrong = cfg.strongSkills.filter((s) => !includesCI(combined, s));
    if (missingStrong.length >= 3 && strongHits.length <= 1) {
        gaps.push(`Missing: ${missingStrong.slice(0, 2).join(", ")}`);
    }
    const visaPositive = ["visa sponsorship", "sponsor", "global payroll", "relocation", "work permit", "h1b", "eu blue card"];
    const visaNegative = ["us citizen only", "security clearance", "citizenship required", "no sponsorship"];
    let visaSupport: string | undefined;
    if (visaPositive.some((k) => includesCI(combined, k) || includesCI(loc, k))) {
        score += 5;
        reasons.push("Visa/sponsorship mentioned");
        visaSupport = "Visa support mentioned";
    }
    if (visaNegative.some((k) => includesCI(combined, k))) {
        score -= 10;
        gaps.push("Citizenship/clearance required — likely no sponsorship");
        visaSupport = "No sponsorship";
    }
    if (/\bIST\b/.test(rawCombined) || /\bIST\b/.test(rawLoc) || includesCI(combined, "india time")) {
        score += 3;
        reasons.push("IST overlap mentioned");
    }
    if (includesCI(combined, "async") || includesCI(combined, "flexible hours")) {
        score += 2;
        reasons.push("Async/flexible hours");
    }
    let salary = job.salary;
    if (!salary) {
        const salaryMatch = combined.match(/[$€£₹]\s?\d[\d,.]*\s?k?(?:\s?[-–—]\s?[$€£₹]?\s?\d[\d,.]*\s?k?)?/i) ??
            combined.match(/\d[\d,.]*\s*(?:usd|eur|gbp|inr|lpa)/i);
        if (salaryMatch) {
            salary = salaryMatch[0].slice(0, 80);
            reasons.push(`Compensation: ${salary}`);
        }
    }
    if (job.isWatchlist) {
        score += cfg.watchlistBoost;
        reasons.push("⭐ Watchlist company");
    }
    score = Math.max(0, Math.min(100, score));
    return { ...job, salary, visaSupport, score, reasons, gaps, matchedSkills };
}
export function scoreMany(jobs: NormalizedJob[], cfg: AppConfig): ScoredJob[] {
    const scored = jobs.map((j) => scoreJob(j, cfg));
    return scored.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        const aWl = a.isWatchlist ? 1 : 0;
        const bWl = b.isWatchlist ? 1 : 0;
        if (bWl !== aWl)
            return bWl - aWl;
        const aTime = a.postedAt ? new Date(a.postedAt).getTime() : 0;
        const bTime = b.postedAt ? new Date(b.postedAt).getTime() : 0;
        if (bTime !== aTime)
            return bTime - aTime;
        return a.title.localeCompare(b.title);
    });
}
