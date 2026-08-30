import { readFile } from "node:fs/promises";
import type { JobSource } from "../types.js";
import { createGreenhouseSource } from "./greenhouse.js";
import { createLeverSource } from "./lever.js";
import { createAshbySource } from "./ashby.js";
import { createSmartRecruitersSource } from "./smartrecruiters.js";

type WatchlistEntry = { slug: string; ats?: "greenhouse" | "lever" | "ashby" | "smartrecruiters"; priority?: string };

export async function loadWatchlistSources(): Promise<JobSource[]> {
  try {
    const raw = await readFile("data/watchlist.json", "utf-8");
    const data = JSON.parse(raw) as { companies: WatchlistEntry[] };
    return data.companies.map((c) => {
      const ats = (c.ats ?? "greenhouse").toLowerCase();
      let base: JobSource;
      if (ats === "lever") base = createLeverSource(c.slug);
      else if (ats === "ashby") base = createAshbySource(c.slug);
      else if (ats === "smartrecruiters") base = createSmartRecruitersSource(c.slug);
      else base = createGreenhouseSource(c.slug);
      // Wrap to mark as watchlist
      const wrapped: JobSource = {
        name: `watchlist:${base.name}`,
        async fetchJobs() {
          const jobs = await base.fetchJobs();
          return jobs.map((j) => ({ ...j, source: `watchlist:${j.source}`, isWatchlist: true } as any));
        },
      };
      return wrapped;
    });
  } catch {
    return [];
  }
}
