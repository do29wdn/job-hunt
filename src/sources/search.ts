import type { JobSource, RawJob } from "../types.js";
import { createGreenhouseSource } from "./greenhouse.js";
import { createLeverSource } from "./lever.js";
import { createAshbySource } from "./ashby.js";
import { createSmartRecruitersSource } from "./smartrecruiters.js";
import { createLinkedInSources } from "./linkedin.js";
import { createJobSpySources } from "./jobspy.js";
import { loadWatchlistSources } from "./watchlist.js";
import { loadHealth, saveHealth, recordSuccess, recordFail, shouldSkip } from "../pipeline/health.js";
import type { AppConfig } from "../config.js";

/**
 * Aggregate all sources. Failures are isolated — one broken board doesn't kill pipeline.
 */
export async function fetchAllSources(cfg: AppConfig): Promise<{ jobs: RawJob[]; errors: string[] }> {
  const healthEnabled = (cfg as any).healthEnabled ?? true;
  const healthStore = healthEnabled ? await loadHealth() : {};

  const watchlistSources = await loadWatchlistSources();
  const smartSources = (cfg as any).smartRecruitersBoards
    ? ((cfg as any).smartRecruitersBoards as string[]).map(createSmartRecruitersSource)
    : [];
  const linkedinSources = (cfg as any).linkedinBoards
    ? createLinkedInSources((cfg as any).linkedinBoards)
    : [];
  const jobspySources = (cfg as any).jobspyBoards
    ? createJobSpySources((cfg as any).jobspyBoards)
    : [];

  const allSources: JobSource[] = [
    ...cfg.greenhouseBoards.map(createGreenhouseSource),
    ...cfg.leverBoards.map(createLeverSource),
    ...cfg.ashbyBoards.map(createAshbySource),
    ...smartSources,
    ...linkedinSources,
    ...jobspySources,
    ...watchlistSources,
  ];

  // Self-healing: filter disabled boards
  const sources = healthEnabled
    ? allSources.filter((s) => {
        if (shouldSkip(s.name, healthStore)) {
          console.log(`[health] skipping disabled ${s.name}`);
          return false;
        }
        return true;
      })
    : allSources;

  if (sources.length === 0) {
    console.warn("[search] No boards configured. Add greenhouseBoards/leverBoards/ashbyBoards in config.");
    return { jobs: [], errors: ["no boards configured"] };
  }

  console.log(`[search] fetching ${sources.length}/${allSources.length} boards (skipped ${allSources.length - sources.length} disabled)`);

  const startTimes = new Map<string, number>();
  sources.forEach((s) => startTimes.set(s.name, Date.now()));

  const results = await Promise.allSettled(sources.map((s) => s.fetchJobs()));
  const jobs: RawJob[] = [];
  const errors: string[] = [];

  results.forEach((r, i) => {
    const name = sources[i].name;
    const latency = Date.now() - (startTimes.get(name) ?? Date.now());
    if (r.status === "fulfilled") {
      console.log(`[${name}] fetched ${r.value.length} in ${latency}ms`);
      jobs.push(...r.value);
      if (healthEnabled) recordSuccess(healthStore, name, r.value.length, latency);
    } else {
      console.warn(`[${name}] error: ${r.reason}`);
      errors.push(`${name}: ${r.reason}`);
      if (healthEnabled) recordFail(healthStore, name, String(r.reason), latency);
    }
    // also treat empty but expected boards as soft fail if they previously had jobs? record anyway
    if (healthEnabled && r.status === "fulfilled" && r.value.length === 0) {
      // don't count as fail, but track stale
      const h = healthStore[name];
      if (h && (h.avgJobs ?? 0) > 5) {
        console.log(`[health] ${name} returned 0 jobs but avg ${h.avgJobs} — flagging stale`);
      }
    }
  });

  if (healthEnabled) {
    await saveHealth(healthStore);
    console.log(`[health] saved ${Object.keys(healthStore).length} boards to data/ats-health.json`);
  }

  return { jobs, errors };
}
