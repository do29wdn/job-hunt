import type { JobSource, RawJob } from "../types.js";
import { createGreenhouseSource } from "./greenhouse.js";
import { createLeverSource } from "./lever.js";
import { createAshbySource } from "./ashby.js";
import type { AppConfig } from "../config.js";

/**
 * Aggregate all sources. Failures are isolated — one broken board doesn't kill pipeline.
 */
export async function fetchAllSources(cfg: AppConfig): Promise<{ jobs: RawJob[]; errors: string[] }> {
  const sources: JobSource[] = [
    ...cfg.greenhouseBoards.map(createGreenhouseSource),
    ...cfg.leverBoards.map(createLeverSource),
    ...cfg.ashbyBoards.map(createAshbySource),
  ];

  if (sources.length === 0) {
    console.warn("[search] No boards configured. Add greenhouseBoards/leverBoards/ashbyBoards in config.");
    return { jobs: [], errors: ["no boards configured"] };
  }

  const results = await Promise.allSettled(sources.map((s) => s.fetchJobs()));
  const jobs: RawJob[] = [];
  const errors: string[] = [];

  results.forEach((r, i) => {
    const name = sources[i].name;
    if (r.status === "fulfilled") {
      console.log(`[${name}] fetched ${r.value.length}`);
      jobs.push(...r.value);
    } else {
      console.warn(`[${name}] error: ${r.reason}`);
      errors.push(`${name}: ${r.reason}`);
    }
  });

  return { jobs, errors };
}
