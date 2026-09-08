import { readFile, writeFile, rm } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobSource, RawJob } from "../types.js";
const execFile = promisify(execFileCb);
type JobSpyOpts = {
    site: string[];
    searchTerm: string;
    location: string;
    resultsWanted?: number;
    hoursOld?: number;
    countryIndeed?: string;
    isRemote?: boolean;
};
const BRIDGE = "scripts/jobspy_bridge.py";
export function createJobSpySource(opts: JobSpyOpts): JobSource {
    const name = `jobspy:${opts.site.join(",")}:${opts.searchTerm}@${opts.location}`;
    return {
        name,
        async fetchJobs(): Promise<RawJob[]> {
            if (process.env.JOBSPY_DISABLED === "true")
                return [];
            const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const optsPath = join(tmpdir(), `jobspy-${stamp}.opts.json`);
            const outPath = join(tmpdir(), `jobspy-${stamp}.out.json`);
            try {
                await writeFile(optsPath, JSON.stringify(opts), "utf-8");
                await execFile("python3", [BRIDGE, optsPath, outPath], { timeout: 120000 });
                const raw = await readFile(outPath, "utf-8");
                const data = JSON.parse(raw || "[]") as Array<Record<string, unknown>>;
                return data
                    .map((r) => ({
                    source: name,
                    externalId: String(r.id ?? r.job_url ?? `${r.title}-${r.company}`),
                    title: (r.title ?? r.job_title) as string,
                    company: (r.company ?? "Unknown") as string,
                    location: (r.location ?? r.city) as string | undefined,
                    description: (r.description ?? r.job_description) as string | undefined,
                    url: (r.job_url ?? r.job_url_direct ?? r.url ?? `https://jobspy.local/${r.id}`) as string,
                    postedAt: (r.date_posted ?? r.posted_at) as string | undefined,
                    employmentType: (r.job_type ?? r.employment_type) as string | undefined,
                }))
                    .filter((j) => j.title && j.company && j.url);
            }
            catch (e) {
                throw new Error(`jobspy bridge failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            finally {
                await rm(optsPath, { force: true }).catch(() => { });
                await rm(outPath, { force: true }).catch(() => { });
            }
        },
    };
}
export function createJobSpySources(configs: Array<JobSpyOpts | string>): JobSource[] {
    if (process.env.JOBSPY_DISABLED === "true")
        return [];
    return configs.map((c) => {
        if (typeof c === "string") {
            const [term, loc] = c.split("@").map((s) => s.trim());
            return createJobSpySource({
                site: ["naukri", "linkedin", "indeed"],
                searchTerm: term,
                location: loc || "Pune, India",
                resultsWanted: 20,
            });
        }
        return createJobSpySource(c);
    });
}
