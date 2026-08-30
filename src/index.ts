import { loadConfig } from "./config.js";
import { fetchAllSources } from "./sources/search.js";
import { normalizeMany } from "./pipeline/normalize.js";
import { filterJobs } from "./pipeline/filter.js";
import { dedupe } from "./pipeline/dedupe.js";
import { scoreMany } from "./pipeline/score.js";
import { loadSeenJobs, saveSeenJobs, partitionNewJobs } from "./storage/seen-jobs.js";
import { sendTelegramFull, sendInstantAlert } from "./notifications/telegram.js";
import { sendEmail } from "./notifications/email.js";
import { enrichWithAI, enrichWithAIHeavy } from "./pipeline/ai.js";
import type { ScoredJob } from "./types.js";
import { readFile } from "node:fs/promises";

type Mode = "hunt" | "report" | "full";

function parseMode(): Mode {
  const arg = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1];
  const env = process.env.MODE as Mode | undefined;
  const m = (arg ?? env ?? "full") as string;
  if (m === "hunt" || m === "report" || m === "full") return m;
  return "full";
}

async function hunt(cfg: Awaited<ReturnType<typeof loadConfig>>) {
  console.log("=== HUNT ===");
  const seen = await loadSeenJobs(cfg.seenJobsPath);
  console.log(`Loaded ${seen.size} seen jobs from ${cfg.seenJobsPath}`);

  const { jobs: rawJobs } = await fetchAllSources(cfg);
  console.log(`Fetched ${rawJobs.length} raw jobs`);

  const normalized = normalizeMany(rawJobs);
  console.log(`Normalized ${normalized.length} (dropped ${rawJobs.length - normalized.length} invalid)`);

  const { kept, dropped } = filterJobs(normalized, cfg);
  console.log(`After filter: ${kept.length} kept, ${dropped.length} dropped`);
  if (dropped.length) console.log(`  Sample drops:`, dropped.slice(0, 3).map((d) => `${d.job.title} @ ${d.job.company} — ${d.reason}`));

  const { unique, duplicates } = dedupe(kept);
  console.log(`After dedupe: ${unique.length} unique, ${duplicates.length} duplicates`);

  const { newJobs, alreadySeen } = partitionNewJobs(unique, seen);
  console.log(`New: ${newJobs.length}, Already seen: ${alreadySeen.length}`);

  let scored = scoreMany(newJobs, cfg);
  // Key-gated heavy AI: if key provided, deep enrich all relevant (60% deterministic + 40% AI), else deterministic only
  if (process.env.OPENAI_API_KEY) {
    const heavy = (process.env.AI_HEAVY ?? "true") !== "false";
    if (heavy) {
      console.log("[ai-heavy] Key present → deep enrich all jobs...");
      scored = await enrichWithAIHeavy(scored, (cfg as any).maxFullReportJobs ?? 150);
    } else {
      console.log("[ai] Enriching top jobs...");
      scored = await enrichWithAI(scored, 15);
    }
  } else {
    console.log("[ai] No key → deterministic only");
  }
  const relevant = scored.filter((j) => j.score >= cfg.minScoreToReport);
  console.log(`Scored: ${scored.length} new, ${relevant.length} >= ${cfg.minScoreToReport} threshold`);

  // Instant alerts for 85%+ (or watchlist 80%+)
  const instant = scored.filter((j) => j.score >= 85 || ((j as any).isWatchlist && j.score >= 80));
  if (instant.length > 0) {
    console.log(`[alert] ${instant.length} instant high-match jobs`);
    try {
      await sendInstantAlert(instant);
    } catch (e) {
      console.error("[alert] failed", e);
    }
  }

  // Persist: update seen with ALL unique (so we don't re-report), but store scored version for report window
  const now = new Date().toISOString();
  for (const j of unique) {
    const existing = seen.get(j.id);
    const scoredVersion = scored.find((s) => s.id === j.id);
    // store scored if available, else normalized
    const toStore = (scoredVersion ?? j) as ScoredJob & { lastSeenAt: string };
    seen.set(j.id, {
      ...toStore,
      lastSeenAt: now,
      // preserve original firstSeenAt if already seen
      firstSeenAt: existing?.firstSeenAt ?? j.firstSeenAt,
    } as any);
  }
  await saveSeenJobs(cfg.seenJobsPath, seen as any);
  console.log(`Saved ${seen.size} seen jobs to ${cfg.seenJobsPath}`);

  return { scored, relevant, newJobs, unique, droppedCount: dropped.length, duplicateCount: duplicates.length };
}

async function report(cfg: Awaited<ReturnType<typeof loadConfig>>) {
  console.log("=== REPORT ===");
  // Read seen jobs that were firstSeen within window
  let candidates: ScoredJob[] = [];
  try {
    const raw = await readFile(cfg.seenJobsPath, "utf-8");
    const all = JSON.parse(raw) as ScoredJob[];
    const cutoff = Date.now() - cfg.reportWindowDays * 24 * 60 * 60 * 1000;
    candidates = all.filter((j) => new Date(j.firstSeenAt).getTime() >= cutoff);
    console.log(`Window: last ${cfg.reportWindowDays} days — ${candidates.length} candidates`);
  } catch {
    console.log("No seen jobs found for report");
  }

  // Re-score in case config changed, then rank — heavy if key present
  let rescored = scoreMany(candidates as any, cfg);
  if (process.env.OPENAI_API_KEY) {
    const heavy = (process.env.AI_HEAVY ?? "true") !== "false";
    rescored = heavy ? await enrichWithAIHeavy(rescored, (cfg as any).maxFullReportJobs ?? 150) : await enrichWithAI(rescored, 15);
  }
  let relevant = rescored.filter((j) => j.score >= cfg.minScoreToReport).sort((a, b) => b.score - a.score);
  const maxFull = (cfg as any).maxFullReportJobs ?? 150;
  if ((cfg as any).reportFull && relevant.length > maxFull) {
    console.log(`[report] capping full report ${relevant.length} -> ${maxFull}`);
    relevant = relevant.slice(0, maxFull);
  }
  const top = relevant.slice(0, cfg.topN);

  console.log(`Top ${top.length} to report (minScore ${cfg.minScoreToReport}) — full ${relevant.length} relevant`);
  top.forEach((j, i) => console.log(`${i + 1}. [${j.score}%] ${j.title} @ ${j.company} — ${j.location} — ${j.url}`));

  const stats = {
    period: `Last ${cfg.reportWindowDays} days`,
    found: rescored.length,
    newCount: candidates.length,
    topCount: top.length,
  };

  // Notifications — isolated failures — send FULL relevant list in markdown
  try {
    await sendTelegramFull(relevant, stats);
  } catch (e) {
    console.error("[telegram] failed", e);
  }
  try {
    await sendEmail(relevant.slice(0, cfg.topN), { period: stats.period, found: stats.found, newCount: stats.newCount });
  } catch (e) {
    console.error("[email] failed", e);
  }

  if (process.env.DRY_RUN === "true") {
    console.log("\n--- DRY_RUN: would send report ---");
    console.log(JSON.stringify(top.slice(0, 3), null, 2));
  }

  return top;
}

async function main() {
  const cfg = await loadConfig();
  const mode = parseMode();
  console.log(`Mode: ${mode} | minScore=${cfg.minScoreToReport} topN=${cfg.topN} window=${cfg.reportWindowDays}d | reportFull=${(cfg as any).reportFull} maxFull=${(cfg as any).maxFullReportJobs}`);
  const gh = cfg.greenhouseBoards.length;
  const lv = cfg.leverBoards.length;
  const ab = cfg.ashbyBoards.length;
  const sr = (cfg as any).smartRecruitersBoards?.length ?? 0;
  const li = (cfg as any).linkedinBoards?.length ?? 0;
  const jp = (cfg as any).jobspyBoards?.length ?? 0;
  console.log(`Boards: greenhouse=${gh} lever=${lv} ashby=${ab} smartRecruiters=${sr} linkedin=${li} jobspy=${jp} total=${gh+lv+ab+sr+li+jp} (+watchlist)`);

  let huntResult: Awaited<ReturnType<typeof hunt>> | null = null;
  if (mode === "hunt" || mode === "full") {
    huntResult = await hunt(cfg);
  }
  if (mode === "report" || mode === "full") {
    // if hunt just ran, report from its result to avoid double read
    if (huntResult && mode === "full") {
      let relevant = huntResult.relevant.sort((a, b) => b.score - a.score);
      const maxFull = (cfg as any).maxFullReportJobs ?? 150;
      const reportFull = (cfg as any).reportFull ?? true;
      if (reportFull && relevant.length > maxFull) {
        console.log(`[report] capping full report ${relevant.length} -> ${maxFull}`);
        relevant = relevant.slice(0, maxFull);
      }
      const stats = {
        period: `Last ${cfg.reportWindowDays} days`,
        found: huntResult.scored.length,
        newCount: huntResult.newJobs.length,
        topCount: Math.min(relevant.length, cfg.topN),
      };
      if (relevant.length > 0) {
        try { await sendTelegramFull(relevant, stats); } catch (e) { console.error(e); }
        try { await sendEmail(relevant.slice(0, cfg.topN), { period: stats.period, found: stats.found, newCount: stats.newCount }); } catch (e) { console.error(e); }
      } else {
        console.log("[report] No new relevant jobs — skipping notification (still persisted)");
      }
    } else {
      await report(cfg);
    }
  }

  // Health digest (self-healing) — send weekly or when disabled boards exist
  if ((cfg as any).includeHealthDigest && (cfg as any).healthEnabled) {
    try {
      const { loadHealth, buildHealthMarkdown } = await import("./pipeline/health.js");
      const store = await loadHealth();
      const disabledCount = Object.values(store).filter((h: any) => h.disabledUntil && new Date(h.disabledUntil).getTime() > Date.now()).length;
      const failingCount = Object.values(store).filter((h: any) => h.consecutiveFails > 0).length;
      const shouldSendHealth = disabledCount > 0 || failingCount > 2 || new Date().getDay() === 0; // Sunday or issues
      if (shouldSendHealth && Object.keys(store).length > 0) {
        const md = buildHealthMarkdown(store);
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
          // send as document via same logic as full report
          const blob = new Blob([md], { type: "text/markdown" });
          const form = new FormData();
          form.append("chat_id", chatId);
          form.append("document", blob, `ats-health-${new Date().toISOString().slice(0, 10)}.md`);
          form.append("caption", `🩺 ATS Health — ${disabledCount} disabled, ${failingCount} failing`);
          await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form as any });
          console.log("[health] digest sent");
        } else {
          console.log("[health] digest (dry):\n" + md.slice(0, 2000));
        }
      }
    } catch (e) {
      console.warn("[health] digest failed", e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
