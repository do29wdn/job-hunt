import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, normalize } from "../pipeline/normalize.js";
import { dedupe } from "../pipeline/dedupe.js";
import { filterJobs, locationTier } from "../pipeline/filter.js";
import { scoreJob } from "../pipeline/score.js";
import { getConfig } from "../config.js";
import type { RawJob, NormalizedJob } from "../types.js";
function mkJob(overrides: Partial<RawJob> = {}): NormalizedJob {
    return normalize({
        source: "greenhouse:test",
        title: "Software Engineer",
        company: "acme",
        location: "Pune, India",
        url: "https://jobs.acme.test/1",
        ...overrides,
    })!;
}
const cfg = getConfig({});
test("fingerprint: punctuation stripped before whitespace collapse (no double spaces)", () => {
    assert.equal(fingerprint({ company: "Vercel", title: "SWE", location: "Remote - United States" }), "vercel|swe|remote united states");
    assert.equal(fingerprint({ company: "Stripe, Inc.", title: "Software Engineer", location: "Pune, India" }), fingerprint({ company: "stripe inc", title: "software engineer", location: "pune india" }));
});
test("normalize: rejects jobs without title/company/url", () => {
    assert.equal(normalize({ source: "x", title: "", company: "c", url: "u" }), null);
    assert.equal(normalize({ source: "x", title: "t", company: "", url: "u" }), null);
    assert.equal(normalize({ source: "x", title: "t", company: "c", url: "" }), null);
});
test("normalize: watchlist flag comes from source or explicit field", () => {
    assert.equal(mkJob({ source: "watchlist:greenhouse:acme" }).isWatchlist, true);
    assert.equal(mkJob({ isWatchlist: true }).isWatchlist, true);
    assert.equal(mkJob().isWatchlist, false);
});
test("dedupe: distinct /jobs/view URLs are NOT collapsed (LinkedIn fallback fix)", () => {
    const jobs = [1, 2, 3].map((i) => mkJob({
        source: "linkedin:React Developer @ Pune, India",
        externalId: `e${i}`,
        title: `React Developer ${i}`,
        company: `Company${i}`,
        url: `https://www.linkedin.com/jobs/view/${i}00`,
    }));
    const { unique, duplicates } = dedupe(jobs);
    assert.equal(unique.length, 3);
    assert.equal(duplicates.length, 0);
});
test("dedupe: identical URL still collapses to one job", () => {
    const jobs = [
        mkJob({ title: "Dev A", url: "https://jobs.acme.test/1" }),
        mkJob({ title: "Dev B", company: "other", url: "https://jobs.acme.test/1" }),
    ];
    assert.equal(dedupe(jobs).unique.length, 1);
});
test("dedupe: fuzzy title at a DIFFERENT location is not a duplicate", () => {
    const jobs = [
        mkJob({ title: "Software Engineer", location: "Pune, India", url: "https://x/1" }),
        mkJob({ title: "Software Engineer 2", location: "Berlin, Germany", url: "https://x/2" }),
    ];
    assert.equal(dedupe(jobs).unique.length, 2);
});
test("dedupe: fuzzy title at the SAME location is a duplicate", () => {
    const jobs = [
        mkJob({ title: "Software Engineer", location: "Remote", url: "https://x/1" }),
        mkJob({ title: "Software Engineer 2", location: "Remote", url: "https://x/2" }),
    ];
    assert.equal(dedupe(jobs).unique.length, 1);
});
test("dedupe: watchlist copy survives a fingerprint collision", () => {
    const jobs = [
        mkJob({ source: "greenhouse:acme" }),
        mkJob({ source: "watchlist:greenhouse:acme" }),
    ];
    const { unique } = dedupe(jobs);
    assert.equal(unique.length, 1);
    assert.equal(unique[0].isWatchlist, true);
});
test("dedupe: strategies are honoured (dedupeFingerprint config key)", () => {
    const jobs = [
        mkJob({ title: "Software Engineer", location: "Pune, India", url: "https://x/1" }),
        mkJob({ title: "Software Engineer", location: "Pune, India", url: "https://x/2" }),
    ];
    assert.equal(dedupe(jobs, "company_title_location").unique.length, 1);
    assert.equal(dedupe(jobs, "url").unique.length, 2);
    assert.equal(dedupe(jobs, "both").unique.length, 1);
});
test("locationTier: generic remote is gated by remoteGlobalAllowed", () => {
    const allow = getConfig({ remoteGlobalAllowed: true });
    const deny = getConfig({ remoteGlobalAllowed: false });
    assert.equal(locationTier("Pune, India", allow), "preferred");
    assert.equal(locationTier("Remote - United States", allow), "remote-global");
    assert.equal(locationTier("Remote - United States", deny), "none");
    assert.equal(locationTier("Remote India", deny), "preferred");
    assert.equal(locationTier("Berlin, Germany", allow), "none");
    assert.equal(locationTier(undefined, allow), "none");
});
test("filter: remoteGlobalAllowed=false actually blocks global remote", () => {
    const deny = getConfig({ remoteGlobalAllowed: false, roles: ["Software Engineer"] });
    const { kept, dropped } = filterJobs([
        mkJob({ location: "Remote - United States" }),
        mkJob({ location: "Remote India" }),
        mkJob({ location: "Pune, India" }),
    ], deny);
    assert.equal(kept.length, 2);
    assert.equal(dropped.length, 1);
    assert.match(dropped[0].reason, /location not preferred/);
});
test("filter: watchlist jobs bypass role and location filtering", () => {
    const { kept } = filterJobs([mkJob({ isWatchlist: true, title: "Design Lead", location: "Berlin, Germany" })], getConfig({ remoteGlobalAllowed: false }));
    assert.equal(kept.length, 1);
});
test("filter: watchlist still respects the seniority blocklist", () => {
    const { kept, dropped } = filterJobs([mkJob({ isWatchlist: true, title: "Engineering Manager" })], cfg);
    assert.equal(kept.length, 0);
    assert.equal(dropped.length, 1);
});
test("filter: seniority blocklist drops staff/principal from titles", () => {
    const { dropped } = filterJobs([mkJob({ title: "Staff Engineer" }), mkJob({ title: "Principal Engineer" })], cfg);
    assert.equal(dropped.length, 2);
});
test("filter: blocklist matches whole words — 'Victor' is not 'CTO'", () => {
    const { kept, dropped } = filterJobs([mkJob({ title: "Software Engineer, Victor Team" })], cfg);
    assert.equal(dropped.length, 0);
    assert.equal(kept.length, 1);
});
test("filter: lenient role path needs STRONG skills, not api/sql/git", () => {
    const c = getConfig({ roles: ["Nonexistent Role"], roleAliases: [] });
    const weak = mkJob({ title: "QA Engineer", description: "we use api sql git rest webservices" });
    const strong = mkJob({ title: "QA Engineer", description: "we love typescript and react daily" });
    const { kept } = filterJobs([weak, strong], c);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].description, strong.description);
});
test("score: short role aliases no longer fuzzy-match junk titles", () => {
    const c = getConfig({ roles: ["Software Engineer"], roleAliases: ["sde"] });
    const job = mkJob({ title: "Model Risk Analyst", description: undefined });
    const scored = scoreJob(job, c);
    assert.equal(scored.reasons.some((r) => r.startsWith("Fuzzy role match")), false);
    assert.equal(scored.reasons.some((r) => r.startsWith("Role title")), false);
});
test("score: watchlistBoost config key is respected (was hardcoded +10)", () => {
    const base = { roles: ["Software Engineer"], preferredLocations: ["pune"] };
    const s10 = scoreJob(mkJob({ isWatchlist: true }), getConfig({ ...base, watchlistBoost: 10 }));
    const s25 = scoreJob(mkJob({ isWatchlist: true }), getConfig({ ...base, watchlistBoost: 25 }));
    assert.equal(s25.score - s10.score, 15);
});
test("score: salary extraction requires a digit after the currency symbol", () => {
    const junk = scoreJob(mkJob({ description: "We offer a competitive salary and benefits." }), cfg);
    assert.equal(junk.salary, undefined);
    const paid = scoreJob(mkJob({ description: "Salary: $130k - $150k depending on experience." }), cfg);
    assert.ok(paid.salary);
    assert.match(paid.salary, /\d/);
});
test("score: IST bonus uses word boundaries (existing/persisting no longer match)", () => {
    const noIst = scoreJob(mkJob({ description: "persisting existing state with consistency" }), cfg);
    assert.equal(noIst.reasons.includes("IST overlap mentioned"), false);
    const ist = scoreJob(mkJob({ description: "overlap with IST hours required" }), cfg);
    assert.equal(ist.reasons.includes("IST overlap mentioned"), true);
});
test("score: does not mutate the input job", () => {
    const job = mkJob({ description: "Visa sponsorship available. $120k salary." });
    const before = JSON.stringify({ ...job });
    scoreJob(job, cfg);
    assert.equal(JSON.stringify({ ...job }), before);
});
test("score: location tiers score preferred > india > remote-global", () => {
    const c = getConfig({ remoteGlobalAllowed: true, preferredLocations: ["pune"] });
    const pref = scoreJob(mkJob({ location: "Pune, India" }), c).score;
    const india = scoreJob(mkJob({ location: "India" }), c).score;
    const remote = scoreJob(mkJob({ location: "Remote - US" }), c).score;
    assert.ok(pref > india);
    assert.ok(india > remote);
});
