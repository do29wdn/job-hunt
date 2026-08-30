import type { JobSource, RawJob } from "../types.js";

// SmartRecruiters public API: https://api.smartrecruiters.com/v1/companies/{company}/postings
// Paginated, no auth
export function createSmartRecruitersSource(company: string): JobSource {
  return {
    name: `smartrecruiters:${company}`,
    async fetchJobs(): Promise<RawJob[]> {
      const out: RawJob[] = [];
      let offset = 0;
      const limit = 100;
      try {
        while (true) {
          const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=${limit}&offset=${offset}`;
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) {
            if (res.status === 404) return out;
            console.warn(`[smartrecruiters:${company}] HTTP ${res.status}`);
            return out;
          }
          const data = (await res.json()) as {
            content?: Array<{
              id: string;
              name: string;
              location?: { city?: string; country?: string; remote?: boolean };
              releasedDate?: string;
              ref?: string;
            }>;
            totalFound?: number;
          };
          const items = data.content ?? [];
          for (const j of items) {
            const loc = j.location;
            const location = loc
              ? [loc.city, loc.country].filter(Boolean).join(", ") + (loc.remote ? " Remote" : "")
              : undefined;
            out.push({
              source: `smartrecruiters:${company}`,
              externalId: j.id,
              title: j.name,
              company,
              location,
              description: undefined,
              url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${j.id}`,
              postedAt: j.releasedDate,
            });
          }
          if (!items.length || out.length >= (data.totalFound ?? Infinity)) break;
          offset += items.length;
          if (offset > 1000) break; // safety cap
        }
      } catch (e) {
        console.warn(`[smartrecruiters:${company}] failed`, e);
      }
      return out;
    },
  };
}
