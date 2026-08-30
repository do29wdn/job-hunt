import type { JobSource, RawJob } from "../types.js";
import { fetchJson } from "../utils.js";

// Ashby public API: https://api.ashbyhq.com/posting-api/job-board/{board}
// Returns { jobs: [...] }
export function createAshbySource(board: string): JobSource {
  return {
    name: `ashby:${board}`,
    async fetchJobs(): Promise<RawJob[]> {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`;
      const data = await fetchJson<{
        jobs: Array<{
          id: string;
          title: string;
          location?: string;
          jobUrl: string;
          publishedAt?: string;
          descriptionHtml?: string;
          employmentType?: string;
        }>;
      }>(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
      if (!data) return [];
      return (data.jobs ?? []).map((j) => ({
        source: `ashby:${board}`,
        externalId: j.id,
        title: j.title,
        company: board,
        location: j.location,
        description: j.descriptionHtml?.replace(/<[^>]*>/g, " ").slice(0, 8000),
        url: j.jobUrl,
        employmentType: j.employmentType,
        postedAt: j.publishedAt,
      }));
    },
  };
}
