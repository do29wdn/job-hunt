import type { JobSource, RawJob } from "../types.js";

// Greenhouse public API: https://boards-api.greenhouse.io/v1/boards/{board}/jobs
// No auth needed. Returns { jobs: [...] }
export function createGreenhouseSource(board: string): JobSource {
  return {
    name: `greenhouse:${board}`,
    async fetchJobs(): Promise<RawJob[]> {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`;
      try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) {
          console.warn(`[greenhouse:${board}] HTTP ${res.status}`);
          return [];
        }
        const data = (await res.json()) as {
          jobs: Array<{
            id: number;
            title: string;
            location?: { name?: string };
            absolute_url: string;
            updated_at?: string;
            content?: string;
          }>;
        };
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
      } catch (e) {
        console.warn(`[greenhouse:${board}] failed`, e);
        return [];
      }
    },
  };
}
