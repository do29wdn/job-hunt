import type { JobSource, RawJob } from "../types.js";

// Dynamic LinkedIn source — uses public guest API via fetch, no auth
// Inspired by Hyraze/open-linkedin-jobs but implemented via direct HTTP to avoid extra dep
// Falls back gracefully; isolated failure doesn't break pipeline

type LinkedInOpts = {
  keyword: string;
  location: string;
  limit?: number;
  dateSincePosted?: string; // past week, past month, 24hr
  remoteFilter?: string;
};

export function createLinkedInSource(opts: LinkedInOpts): JobSource {
  const { keyword, location, limit = 25, dateSincePosted, remoteFilter } = opts;
  const name = `linkedin:${keyword}@${location}`;
  return {
    name,
    async fetchJobs(): Promise<RawJob[]> {
      // Try Hyraze/open-linkedin-jobs if installed, otherwise use public guest API
      try {
        // Attempt to use npm package if available
        const mod: any = await import("open-linkedin-jobs").catch(() => null);
        if (mod?.linkedInJobSearch) {
          const jobs = await mod.linkedInJobSearch({
            keyword,
            location,
            limit,
            dateSincePosted,
            remoteFilter,
          });
          return (jobs as any[]).map((j: any) => ({
            source: name,
            externalId: String(j.id ?? j.jobId ?? j.url),
            title: j.title,
            company: j.company?.name ?? j.company ?? "Unknown",
            location: j.location,
            description: j.description ?? j.descriptionText,
            url: j.url ?? j.link,
            postedAt: j.date ?? j.datePosted,
          }));
        }
      } catch {}

      // Fallback: direct LinkedIn guest API (no auth, HTTP)
      // Uses LinkedIn's public jobs/guest/jobs/api/seeMoreJobPostings/search
      try {
        const params = new URLSearchParams({
          keywords: keyword,
          location,
          start: "0",
        });
        if (dateSincePosted) {
          const map: Record<string, string> = { "24hr": "r86400", "past week": "r604800", "past month": "r2592000" };
          if (map[dateSincePosted]) params.set("f_TPR", map[dateSincePosted]);
        }
        if (remoteFilter) {
          const rm: Record<string, string> = { remote: "2", "on-site": "1", hybrid: "3" };
          if (rm[remoteFilter]) params.set("f_WT", rm[remoteFilter]);
        }
        // We fetch the HTML and parse with cheerio-like regex (lightweight, no dep)
        const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; job-hunter/1.0)",
            Accept: "text/html",
          },
        });
        if (!res.ok) {
          console.warn(`[${name}] HTTP ${res.status}`);
          return [];
        }
        const html = await res.text();
        // Parse: LinkedIn returns <div class="base-card ..."> with data-entity-urn and job title
        const jobs: RawJob[] = [];
        const re = /data-entity-urn="urn:li:jobPosting:(\d+)".*?base-search-card__title[^>]*>([^<]+)<.*?base-search-card__subtitle[^>]*>.*?>([^<]+)<.*?job-search-card__location[^>]*>([^<]+)<.*?time-ago[^>]*datetime="([^"]+)"/gs;
        let m: RegExpExecArray | null;
        let count = 0;
        while ((m = re.exec(html)) !== null && count < limit) {
          const [, id, title, company, locationTxt, datetime] = m;
          jobs.push({
            source: name,
            externalId: id,
            title: title.trim(),
            company: company.trim(),
            location: locationTxt.trim(),
            description: undefined,
            url: `https://www.linkedin.com/jobs/view/${id}`,
            postedAt: datetime,
          });
          count++;
        }
        if (jobs.length === 0) {
          // fallback: try simpler regex for title/company
          const altRe = /base-search-card__title[^>]*>([^<]+)<.*?<a[^>]*>([^<]+)<.*?job-search-card__location[^>]*>([^<]+)</gs;
          while ((m = altRe.exec(html)) !== null && jobs.length < limit) {
            const [, title, company, loc] = m;
            jobs.push({
              source: name,
              externalId: `${keyword}-${jobs.length}`,
              title: title.trim(),
              company: company.trim(),
              location: loc.trim(),
              description: undefined,
              url: `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}`,
              postedAt: undefined,
            });
          }
        }
        console.log(`[${name}] fallback fetched ${jobs.length}`);
        return jobs;
      } catch (e) {
        console.warn(`[${name}] failed`, e);
        return [];
      }
    },
  };
}

// Helper to create multiple LinkedIn sources from config
export function createLinkedInSources(
  configs: Array<string | { keyword: string; location: string; limit?: number }>,
): JobSource[] {
  return configs.map((c) => {
    if (typeof c === "string") {
      // string format: "keyword @ location" or just "keyword"
      const [kw, loc] = c.split("@").map((s) => s.trim());
      return createLinkedInSource({ keyword: kw, location: loc || "India", limit: 25 });
    }
    return createLinkedInSource(c);
  });
}
