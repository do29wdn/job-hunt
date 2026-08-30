import type { JobSource, RawJob } from "../types.js";
import { fetchJson } from "../utils.js";

// Lever public API: https://api.lever.co/v0/postings/{board}?mode=json
export function createLeverSource(board: string): JobSource {
  return {
    name: `lever:${board}`,
    async fetchJobs(): Promise<RawJob[]> {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`;
      const data = await fetchJson<
        Array<{
          id: string;
          text: string;
          categories?: { location?: string; commitment?: string };
          hostedUrl: string;
          createdAt?: number;
          descriptionPlain?: string;
          description?: string;
        }>
      >(url);
      if (!data) return [];
      const jobs = Array.isArray(data) ? data : [];
      return jobs.map((j) => ({
        source: `lever:${board}`,
        externalId: j.id,
        title: j.text,
        company: board,
        location: j.categories?.location,
        employmentType: j.categories?.commitment,
        description: (j.descriptionPlain ?? j.description ?? "").replace(/<[^>]*>/g, " ").slice(0, 8000),
        url: j.hostedUrl,
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      }));
    },
  };
}
