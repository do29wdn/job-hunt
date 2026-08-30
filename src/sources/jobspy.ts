import { readFile } from "node:fs/promises";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import type { JobSource, RawJob } from "../types.js";

const exec = promisify(execCb);

type JobSpyOpts = {
  site: string[]; // ["linkedin","naukri","indeed","google","zip_recruiter"]
  searchTerm: string;
  location: string;
  resultsWanted?: number;
  hoursOld?: number;
  countryIndeed?: string;
  isRemote?: boolean;
};

// Python bridge: requires python3 and python-jobspy (pip install python-jobspy)
// If not available, gracefully returns []
export function createJobSpySource(opts: JobSpyOpts): JobSource {
  const name = `jobspy:${opts.site.join(",")}:${opts.searchTerm}@${opts.location}`;
  return {
    name,
    async fetchJobs(): Promise<RawJob[]> {
      if (process.env.JOBSPY_DISABLED === "true") return [];
      const { site, searchTerm, location, resultsWanted = 20, hoursOld = 72, countryIndeed, isRemote } = opts;
      const tmpJson = `/tmp/jobspy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const py = `
import json, sys
try:
    from jobspy import scrape_jobs
    jobs = scrape_jobs(
        site_name=${JSON.stringify(site)},
        search_term=${JSON.stringify(searchTerm)},
        location=${JSON.stringify(location)},
        results_wanted=${resultsWanted},
        hours_old=${hoursOld},
        country_indeed=${JSON.stringify(countryIndeed ?? "India")},
        is_remote=${isRemote ? "True" : "False"},
        verbose=0,
    )
    # jobspy returns pandas DataFrame, convert to json
    if hasattr(jobs, "to_dict"):
        data = jobs.to_dict(orient="records")
    else:
        data = []
    # clean NaN
    import math
    out=[]
    for r in data:
        for k,v in list(r.items()):
            if isinstance(v, float) and math.isnan(v):
                r[k]=None
        out.append(r)
    with open(${JSON.stringify(tmpJson)}, "w") as f:
        json.dump(out, f)
    print(f"jobspy done {len(out)}")
except Exception as e:
    print(f"jobspy error: {e}", file=sys.stderr)
    with open(${JSON.stringify(tmpJson)}, "w") as f:
        json.dump([], f)
    sys.exit(0)
`;
      try {
        await exec(`python3 -c ${JSON.stringify(py)}`, { timeout: 60000 });
        if (!existsSync(tmpJson)) return [];
        const raw = await readFile(tmpJson, "utf-8");
        const data = JSON.parse(raw) as any[];
        const jobs: RawJob[] = data.map((r: any) => ({
          source: name,
          externalId: String(r.id ?? r.job_url ?? `${r.title}-${r.company}`),
          title: r.title ?? r.job_title ?? "Unknown",
          company: r.company ?? "Unknown",
          location: r.location ?? r.city,
          description: r.description ?? r.job_description,
          url: r.job_url ?? r.job_url_direct ?? r.url ?? `https://jobspy.local/${r.id}`,
          postedAt: r.date_posted ?? r.posted_at,
          employmentType: r.job_type ?? r.employment_type,
        }));
        return jobs.filter((j) => j.title && j.company && j.url);
      } catch (e) {
        console.warn(`[${name}] jobspy failed`, e);
        return [];
      }
    },
  };
}

export function createJobSpySources(
  configs: Array<JobSpyOpts | string>,
): JobSource[] {
  if (process.env.JOBSPY_DISABLED === "true") return [];
  return configs.map((c) => {
    if (typeof c === "string") {
      // string format: "searchTerm @ location"
      const [term, loc] = c.split("@").map((s) => s.trim());
      return createJobSpySource({ site: ["naukri", "linkedin", "indeed"], searchTerm: term, location: loc || "Pune, India", resultsWanted: 20 });
    }
    return createJobSpySource(c);
  });
}
