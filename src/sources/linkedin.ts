import type { JobSource, RawJob } from "../types.js";
import { decodeEntities } from "../utils.js";
type LinkedInOpts = {
    keyword: string;
    location: string;
    limit?: number;
    dateSincePosted?: string;
    remoteFilter?: string;
};
function grab(html: string, re: RegExp): string | undefined {
    const m = html.match(re);
    return m?.[1] ? decodeEntities(m[1]).trim() : undefined;
}
export function createLinkedInSource(opts: LinkedInOpts): JobSource {
    const { keyword, location, limit = 25, dateSincePosted, remoteFilter } = opts;
    const name = `linkedin:${keyword}@${location}`;
    return {
        name,
        async fetchJobs(): Promise<RawJob[]> {
            try {
                const params = new URLSearchParams({ keywords: keyword, location, start: "0" });
                if (dateSincePosted) {
                    const map: Record<string, string> = { "24hr": "r86400", "past week": "r604800", "past month": "r2592000" };
                    if (map[dateSincePosted])
                        params.set("f_TPR", map[dateSincePosted]);
                }
                if (remoteFilter) {
                    const rm: Record<string, string> = { remote: "2", "on-site": "1", hybrid: "3" };
                    if (rm[remoteFilter])
                        params.set("f_WT", rm[remoteFilter]);
                }
                const res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                        "Accept-Language": "en-US,en;q=0.9",
                        Accept: "text/html",
                    },
                    signal: AbortSignal.timeout(20000),
                });
                if (!res.ok) {
                    console.warn(`[${name}] HTTP ${res.status}`);
                    return [];
                }
                const html = await res.text();
                return parseGuestHtml(html, name, limit);
            }
            catch (e) {
                console.warn(`[${name}] failed`, e instanceof Error ? e.message : e);
                return [];
            }
        },
    };
}
function parseGuestHtml(html: string, source: string, limit: number): RawJob[] {
    const jobs: RawJob[] = [];
    const chunks = html.split(/(?=data-entity-urn="urn:li:jobPosting:)/);
    for (const chunk of chunks.slice(1)) {
        if (jobs.length >= limit)
            break;
        const id = grab(chunk, /data-entity-urn="urn:li:jobPosting:(\d+)"/);
        const href = grab(chunk, /<a[^>]+href="([^"]*\/jobs\/view\/[^"]*)"/);
        const url = id ? `https://www.linkedin.com/jobs/view/${id}` : href;
        const title = grab(chunk, /base-search-card__title[^>]*>\s*(?:<[^>]+>\s*)*([^<]+)/);
        const company = grab(chunk, /base-search-card__subtitle[\s\S]{0,300}?<a[^>]*>([^<]+)</) ??
            grab(chunk, /base-search-card__subtitle[^>]*>\s*([^<]+)/);
        const location = grab(chunk, /job-search-card__location[^>]*>\s*([^<]+)/);
        const postedAt = grab(chunk, /datetime="([^"]+)"/);
        if (!title || !company || !url)
            continue;
        jobs.push({
            source,
            externalId: id ?? href,
            title,
            company,
            location,
            description: undefined,
            url,
            postedAt,
        });
    }
    if (jobs.length === 0) {
        console.warn(`[${source}] 0 jobs parsed (LinkedIn markup may have changed or an auth wall was served)`);
    }
    else {
        console.log(`[${source}] parsed ${jobs.length} jobs`);
    }
    return jobs;
}
export function createLinkedInSources(configs: Array<string | {
    keyword: string;
    location: string;
    limit?: number;
}>): JobSource[] {
    return configs.map((c) => {
        if (typeof c === "string") {
            const [kw, loc] = c.split("@").map((s) => s.trim());
            return createLinkedInSource({ keyword: kw, location: loc || "India", limit: 25 });
        }
        return createLinkedInSource(c);
    });
}
