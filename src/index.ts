import { loadConfig } from "./config.js";
import { fetchAllSources } from "./sources/search.js";
import { normalizeMany } from "./pipeline/normalize.js";
import { filterJobs } from "./pipeline/filter.js";
import { dedupe } from "./pipeline/dedupe.js";
import { scoreMany, scoreJob } from "./pipeline/score.js";
import { loadSeenJobs, saveSeenJobs, partitionNewJobs } from "./storage/seen-jobs.js";
import { sendTelegramFull, sendInstantAlert } from "./notifications/telegram.js";
import { sendEmail } from "./notifications/email.js";
import { enrichWithAI, enrichWithAIHeavy } from "./pipeline/ai.js";
import { loadDotEnv, isDryRun } from "./env.js";
import type { NormalizedJob, ScoredJob } from "./types.js";
import type { AppConfig } from "./config.js";
import { readFile } from "node:fs/promises";
type Mode = "hunt" | "report" | "full";
function parseMode(): Mode {
    const arg = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1];
    const env = process.env.MODE as Mode | undefined;
    const m = (arg ?? env ?? "full") as string;
    if (m === "hunt" || m === "report" || m === "full")
        return m;
    return "full";
}
type HuntResult = {
    scored: ScoredJob[];
    relevant: ScoredJob[];
    newJobs: NormalizedJob[];
    unique: NormalizedJob[];
    droppedCount: number;
    duplicateCount: number;
};
function instantThreshold(cfg: AppConfig): number {
    return Number(process.env.INSTANT_ALERT_THRESHOLD) || cfg.instantAlertThreshold;
}
async function hunt(cfg: AppConfig): Promise<HuntResult> {
    console.log("=== HUNT ===");
    const seen = await loadSeenJobs(cfg.seenJobsPath);
    console.log(`Loaded ${seen.size} seen jobs from ${cfg.seenJobsPath}`);
    const { jobs: rawJobs } = await fetchAllSources(cfg);
    console.log(`Fetched ${rawJobs.length} raw jobs`);
    const normalized = normalizeMany(rawJobs);
    console.log(`Normalized ${normalized.length} (dropped ${rawJobs.length - normalized.length} invalid)`);
    const { kept, dropped } = filterJobs(normalized, cfg);
    console.log(`After filter: ${kept.length} kept, ${dropped.length} dropped`);
    if (dropped.length)
        console.log(`  Sample drops:`, dropped.slice(0, 3).map((d) => `${d.job.title} @ ${d.job.company} — ${d.reason}`));
    const { unique, duplicates } = dedupe(kept, cfg.dedupeFingerprint);
    console.log(`After dedupe: ${unique.length} unique, ${duplicates.length} duplicates`);
    const { newJobs, alreadySeen } = partitionNewJobs(unique, seen);
    console.log(`New: ${newJobs.length}, Already seen: ${alreadySeen.length}`);
    let scored = scoreMany(newJobs, cfg);
    if (process.env.OPENAI_API_KEY) {
        const heavy = (process.env.AI_HEAVY ?? "true") !== "false";
        if (heavy) {
            console.log("[ai-heavy] Key present → deep enrich relevant jobs...");
            scored = await enrichWithAIHeavy(scored, cfg.maxFullReportJobs);
        }
        else {
            console.log("[ai] Enriching top jobs...");
            scored = await enrichWithAI(scored, 15);
        }
    }
    else {
        console.log("[ai] No key → deterministic only");
    }
    const relevant = scored.filter((j) => j.score >= cfg.minScoreToReport);
    console.log(`Scored: ${scored.length} new, ${relevant.length} >= ${cfg.minScoreToReport} threshold`);
    const now = new Date().toISOString();
    const scoredById = new Map(scored.map((s) => [s.id, s] as const));
    for (const j of unique) {
        const existing = seen.get(j.id);
        if (existing) {
            seen.set(j.id, { ...existing, lastSeenAt: now });
        }
        else {
            seen.set(j.id, { ...(scoredById.get(j.id) ?? j), lastSeenAt: now });
        }
    }
    await saveSeenJobs(cfg.seenJobsPath, seen);
    console.log(`Saved ${seen.size} seen jobs to ${cfg.seenJobsPath}`);
    const threshold = instantThreshold(cfg);
    const instant = scored.filter((j) => j.score >= threshold || (j.isWatchlist && j.score >= threshold - 5));
    if (instant.length > 0) {
        if (isDryRun()) {
            console.log(`[alert] DRY_RUN — skipping ${instant.length} instant alerts`);
        }
        else {
            console.log(`[alert] ${instant.length} instant high-match jobs (>= ${threshold}%)`);
            try {
                await sendInstantAlert(instant, threshold);
            }
            catch (e) {
                console.error("[alert] failed", e);
            }
        }
    }
    return { scored, relevant, newJobs, unique, droppedCount: dropped.length, duplicateCount: duplicates.length };
}
async function report(cfg: AppConfig): Promise<ScoredJob[]> {
    console.log("=== REPORT ===");
    let candidates: ScoredJob[] = [];
    try {
        const raw = await readFile(cfg.seenJobsPath, "utf-8");
        const all = JSON.parse(raw) as ScoredJob[];
        const cutoff = Date.now() - cfg.reportWindowDays * 24 * 60 * 60 * 1000;
        candidates = all.filter((j) => new Date(j.firstSeenAt).getTime() >= cutoff);
        console.log(`Window: last ${cfg.reportWindowDays} days — ${candidates.length} candidates`);
    }
    catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err?.code === "ENOENT")
            console.log("No seen-jobs file yet — nothing to report");
        else
            console.error("[report] could not read seen jobs:", err?.message ?? err);
    }
    const scoredCandidates = candidates.map((j) => (typeof j.score === "number" ? j : scoreJob(j, cfg)));
    let relevant = scoredCandidates
        .filter((j) => j.score >= cfg.minScoreToReport)
        .sort((a, b) => b.score - a.score);
    if (cfg.reportFull && relevant.length > cfg.maxFullReportJobs) {
        console.log(`[report] capping full report ${relevant.length} -> ${cfg.maxFullReportJobs}`);
        relevant = relevant.slice(0, cfg.maxFullReportJobs);
    }
    const top = relevant.slice(0, cfg.topN);
    console.log(`Top ${top.length} to report (minScore ${cfg.minScoreToReport}) — full ${relevant.length} relevant`);
    top.forEach((j, i) => console.log(`${i + 1}. [${j.score}%] ${j.title} @ ${j.company} — ${j.location ?? "—"} — ${j.url}`));
    const stats = {
        period: `Last ${cfg.reportWindowDays} days`,
        found: relevant.length,
        newCount: candidates.length,
        topCount: top.length,
    };
    if (isDryRun()) {
        console.log("[report] DRY_RUN — notifications suppressed");
        if (top.length)
            console.log(JSON.stringify(top.slice(0, 3), null, 2));
    }
    else {
        try {
            await sendTelegramFull(relevant, stats);
        }
        catch (e) {
            console.error("[telegram] failed", e);
        }
        try {
            await sendEmail(top, { period: stats.period, found: stats.found, newCount: stats.newCount });
        }
        catch (e) {
            console.error("[email] failed", e);
        }
    }
    return top;
}
async function main() {
    await loadDotEnv();
    const cfg = await loadConfig();
    const mode = parseMode();
    console.log(`Mode: ${mode}${isDryRun() ? " (DRY_RUN)" : ""} | minScore=${cfg.minScoreToReport} topN=${cfg.topN} window=${cfg.reportWindowDays}d | reportFull=${cfg.reportFull} maxFull=${cfg.maxFullReportJobs}`);
    const gh = cfg.greenhouseBoards.length;
    const lv = cfg.leverBoards.length;
    const ab = cfg.ashbyBoards.length;
    const sr = cfg.smartRecruitersBoards.length;
    const li = cfg.linkedinBoards.length;
    const jp = cfg.jobspyBoards.length;
    console.log(`Boards: greenhouse=${gh} lever=${lv} ashby=${ab} smartRecruiters=${sr} linkedin=${li} jobspy=${jp} total=${gh + lv + ab + sr + li + jp} (+watchlist)`);
    let huntResult: HuntResult | null = null;
    if (mode === "hunt" || mode === "full") {
        huntResult = await hunt(cfg);
    }
    if (mode === "report" || mode === "full") {
        if (huntResult && mode === "full") {
            let relevant = [...huntResult.relevant].sort((a, b) => b.score - a.score);
            if (cfg.reportFull && relevant.length > cfg.maxFullReportJobs) {
                console.log(`[report] capping full report ${relevant.length} -> ${cfg.maxFullReportJobs}`);
                relevant = relevant.slice(0, cfg.maxFullReportJobs);
            }
            const stats = {
                period: `Last ${cfg.reportWindowDays} days`,
                found: relevant.length,
                newCount: huntResult.newJobs.length,
                topCount: Math.min(relevant.length, cfg.topN),
            };
            if (relevant.length > 0) {
                if (isDryRun()) {
                    console.log("[report] DRY_RUN — notifications suppressed");
                }
                else {
                    try {
                        await sendTelegramFull(relevant, stats);
                    }
                    catch (e) {
                        console.error("[telegram] failed", e);
                    }
                    try {
                        await sendEmail(relevant.slice(0, cfg.topN), {
                            period: stats.period,
                            found: stats.found,
                            newCount: stats.newCount,
                        });
                    }
                    catch (e) {
                        console.error("[email] failed", e);
                    }
                }
            }
            else {
                console.log("[report] No new relevant jobs — skipping notification (state still persisted)");
            }
        }
        else {
            await report(cfg);
        }
    }
    if (cfg.includeHealthDigest && cfg.healthEnabled) {
        try {
            const { loadHealth, buildHealthMarkdown } = await import("./pipeline/health.js");
            const store = await loadHealth(cfg.healthPath);
            const disabledCount = Object.values(store).filter((h) => h.disabledUntil && new Date(h.disabledUntil).getTime() > Date.now()).length;
            const failingCount = Object.values(store).filter((h) => h.consecutiveFails > 0).length;
            const istDay = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCDay();
            const shouldSendHealth = disabledCount > 0 || failingCount > 2 || istDay === 0;
            if (shouldSendHealth && Object.keys(store).length > 0) {
                const md = buildHealthMarkdown(store);
                const token = process.env.TELEGRAM_BOT_TOKEN;
                const chatId = process.env.TELEGRAM_CHAT_ID;
                if (token && chatId && !isDryRun()) {
                    const blob = new Blob([md], { type: "text/markdown" });
                    const form = new FormData();
                    form.append("chat_id", chatId);
                    form.append("document", blob, `ats-health-${new Date().toISOString().slice(0, 10)}.md`);
                    form.append("caption", `🩺 ATS Health — ${disabledCount} disabled, ${failingCount} failing`);
                    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
                        method: "POST",
                        body: form as any,
                        signal: AbortSignal.timeout(60000),
                    });
                    if (!res.ok)
                        console.warn(`[health] digest send failed HTTP ${res.status}`);
                    else
                        console.log("[health] digest sent");
                }
                else {
                    console.log("[health] digest (dry):\n" + md.slice(0, 2000));
                }
            }
        }
        catch (e) {
            console.warn("[health] digest failed", e);
        }
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
