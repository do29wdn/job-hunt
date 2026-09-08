import type { JobSource, RawJob } from "../types.js";
import { fetchJson } from "../utils.js";
export function createSmartRecruitersSource(company: string): JobSource {
    return {
        name: `smartrecruiters:${company}`,
        async fetchJobs(): Promise<RawJob[]> {
            const out: RawJob[] = [];
            let offset = 0;
            const limit = 100;
            while (true) {
                const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=${limit}&offset=${offset}`;
                const data = await fetchJson<{
                    content?: Array<{
                        id: string;
                        name: string;
                        location?: {
                            city?: string;
                            country?: string;
                            remote?: boolean;
                        };
                        releasedDate?: string;
                        ref?: string;
                    }>;
                    totalFound?: number;
                }>(url);
                if (!data)
                    return out;
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
                if (!items.length || out.length >= (data.totalFound ?? Infinity))
                    break;
                offset += items.length;
                if (offset > 1000)
                    break;
            }
            return out;
        },
    };
}
