import { loadConfig } from "./config.js";
import { fetchAllSources } from "./sources/search.js";
import { normalizeMany } from "./pipeline/normalize.js";
import { filterJobs } from "./pipeline/filter.js";
import { dedupe } from "./pipeline/dedupe.js";
import { scoreMany } from "./pipeline/score.js";
import { loadSeenJobs, saveSeenJobs, partitionNewJobs } from "./storage/seen-jobs.js";
import { sendTelegram } from "./notifications/telegram.js";
import { sendEmail } from "./notifications/email.js";
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

  const scored = scoreMany(newJobs, cfg);
  const relevant = scored.filter((j) => j.score >= cfg.minScoreToReport);
  console.log(`Scored: ${scored.length} new, ${relevant.length} >= ${cfg.minScoreToReport} threshold`);

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

  // Re-score in case config changed, then rank
  const rescored = scoreMany(candidates as any, cfg);
  const top = rescored.filter((j) => j.score >= cfg.minScoreToReport).sort((a, b) => b.score - a.score).slice(0, cfg.topN);

  console.log(`Top ${top.length} to report (minScore ${cfg.minScoreToReport})`);
  top.forEach((j, i) => console.log(`${i + 1}. [${j.score}%] ${j.title} @ ${j.company} — ${j.location} — ${j.url}`));

  const stats = {
    period: `Last ${cfg.reportWindowDays} days`,
    found: rescored.length,
    newCount: candidates.length,
    topCount: top.length,
  };

  // Notifications — isolated failures
  try {
    await sendTelegram(top, stats);
  } catch (e) {
    console.error("[telegram] failed", e);
  }
  try {
    await sendEmail(top, { period: stats.period, found: stats.found, newCount: stats.newCount });
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
  console.log(`Mode: ${mode} | minScore=${cfg.minScoreToReport} topN=${cfg.topN} window=${cfg.reportWindowDays}d`);
  console.log(`Boards: greenhouse=${cfg.greenhouseBoards.length} lever=${cfg.leverBoards.length} ashby=${cfg.ashbyBoards.length}`);

  let huntResult: Awaited<ReturnType<typeof hunt>> | null = null;
  if (mode === "hunt" || mode === "full") {
    huntResult = await hunt(cfg);
  }
  if (mode === "report" || mode === "full") {
    // if hunt just ran, report from its result to avoid double read
    if (huntResult && mode === "full") {
      const top = huntResult.relevant.sort((a, b) => b.score - a.score).slice(0, cfg.topN);
      const stats = {
        period: `Last ${cfg.reportWindowDays} days`,
        found: huntResult.scored.length,
        newCount: huntResult.newJobs.length,
        topCount: top.length,
      };
      // Only send if there are new relevant jobs — avoids spam on daily hunt with no news
      // For every-3-days schedule, this naturally batches
      if (top.length > 0) {
        try { await sendTelegram(top, stats); } catch (e) { console.error(e); }
        try { await sendEmail(top, { period: stats.period, found: stats.found, newCount: stats.newCount }); } catch (e) { console.error(e); }
      } else {
        console.log("[report] No new relevant jobs — skipping notification (still persisted)");
      }
    } else {
      await report(cfg);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
