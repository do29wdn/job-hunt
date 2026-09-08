import type { JobSource, RawJob } from "../types.js";
import { createGreenhouseSource } from "./greenhouse.js";
import { createLeverSource } from "./lever.js";
import { createAshbySource } from "./ashby.js";
import { createSmartRecruitersSource } from "./smartrecruiters.js";
import { createLinkedInSources } from "./linkedin.js";
import { createJobSpySources } from "./jobspy.js";
import { loadWatchlistSources } from "./watchlist.js";
import { loadHealth, saveHealth, recordSuccess, recordFail, shouldSkip } from "../pipeline/health.js";
import { pLimit } from "../utils.js";
import type { AppConfig } from "../config.js";
const FETCH_CONCURRENCY = 8;
export async function fetchAllSources(cfg: AppConfig): Promise<{
    jobs: RawJob[];
    errors: string[];
}> {
    const healthStore = cfg.healthEnabled ? await loadHealth(cfg.healthPath) : {};
    const watchlistSources = await loadWatchlistSources();
    const watchlistBase = new Set(watchlistSources.map((s) => s.name.replace(/^watchlist:/, "")));
    const dropDupe = (s: JobSource) => !watchlistBase.has(s.name);
    const smartSources = cfg.smartRecruitersBoards.map(createSmartRecruitersSource);
    const linkedinSources = createLinkedInSources(cfg.linkedinBoards);
    const jobspySources = createJobSpySources(cfg.jobspyBoards);
    const allSources: JobSource[] = [
        ...cfg.greenhouseBoards.map(createGreenhouseSource).filter(dropDupe),
        ...cfg.leverBoards.map(createLeverSource).filter(dropDupe),
        ...cfg.ashbyBoards.map(createAshbySource).filter(dropDupe),
        ...smartSources.filter(dropDupe),
        ...linkedinSources,
        ...jobspySources,
        ...watchlistSources,
    ];
    const sources = cfg.healthEnabled
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
    console.log(`[search] fetching ${sources.length}/${allSources.length} boards (skipped ${allSources.length - sources.length} disabled), concurrency ${FETCH_CONCURRENCY}`);
    const limit = pLimit(FETCH_CONCURRENCY);
    const results = await Promise.all(sources.map((s) => limit(async () => {
        const start = Date.now();
        try {
            const value = await s.fetchJobs();
            return { ok: true as const, name: s.name, latency: Date.now() - start, value };
        }
        catch (reason) {
            return { ok: false as const, name: s.name, latency: Date.now() - start, reason: reason as unknown };
        }
    })));
    const jobs: RawJob[] = [];
    const errors: string[] = [];
    for (const r of results) {
        if (r.ok) {
            console.log(`[${r.name}] fetched ${r.value.length} in ${r.latency}ms`);
            jobs.push(...r.value);
            if (cfg.healthEnabled)
                recordSuccess(healthStore, r.name, r.value.length, r.latency);
            if (r.value.length === 0) {
                const h = healthStore[r.name];
                if (h && (h.avgJobs ?? 0) > 5) {
                    console.log(`[health] ${r.name} returned 0 jobs but avg ${h.avgJobs} — flagging stale`);
                }
            }
        }
        else {
            console.warn(`[${r.name}] error: ${r.reason}`);
            errors.push(`${r.name}: ${r.reason}`);
            if (cfg.healthEnabled)
                recordFail(healthStore, r.name, String(r.reason), r.latency);
        }
    }
    if (cfg.healthEnabled) {
        await saveHealth(healthStore, cfg.healthPath);
        console.log(`[health] saved ${Object.keys(healthStore).length} boards to ${cfg.healthPath}`);
    }
    return { jobs, errors };
}
