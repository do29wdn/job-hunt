import type { JobSource, RawJob } from "../types.js";
import { fetchJson } from "../utils.js";

// Greenhouse public API: https://boards-api.greenhouse.io/v1/boards/{board}/jobs
// No auth needed. Returns { jobs: [...] }
export function createGreenhouseSource(board: string): JobSource {
  return {
    name: `greenhouse:${board}`,
    async fetchJobs(): Promise<RawJob[]> {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`;
      const data = await fetchJson<{
        jobs: Array<{
          id: number;
          title: string;
          location?: { name?: string };
          absolute_url: string;
          updated_at?: string;
          content?: string;
        }>;
      }>(url);
      if (!data) return [];
      return (data.jobs ?? []).map((j) => ({
        source: `greenhouse:${board}`,
        externalId: String(j.id),
        title: j.title,
        company: board,
        location: j.location?.name,
        description: j.content?.replace(/<[^>]*>/g, " ").slice(0, 8000),
        url: j.absolute_url,
        postedAt: j.updated_at,
      }));
    },
  };
}
