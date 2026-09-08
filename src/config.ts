import { z } from "zod";
const configSchema = z.object({
    roles: z.array(z.string()).default([
        "Full Stack Developer",
        "Full Stack Engineer",
        "Software Engineer",
        "Software Developer",
        "Frontend Developer",
        "Frontend Engineer",
        "Backend Developer",
        "Backend Engineer",
        "React Developer",
        "Node.js Developer",
        "TypeScript Developer",
    ]),
    roleAliases: z.array(z.string()).default([
        "product engineer",
        "web engineer",
        "javascript engineer",
        "application developer",
        "sde",
    ]),
    skills: z.array(z.string()).default([
        "typescript",
        "javascript",
        "react",
        "node.js",
        "nodejs",
        "postgresql",
        "postgres",
        "sql",
        "rest",
        "api",
        "tailwind",
        "git",
        "full stack",
        "frontend",
        "backend",
        "web development",
    ]),
    strongSkills: z.array(z.string()).default([
        "typescript",
        "react",
        "node.js",
        "nodejs",
        "postgresql",
    ]),
    preferredLocations: z.array(z.string()).default([
        "pune",
        "remote india",
        "remote - india",
        "india remote",
        "mumbai",
        "bengaluru",
        "bangalore",
        "hyderabad",
        "remote",
    ]),
    remoteGlobalAllowed: z.boolean().default(true),
    seniorityBlocklist: z.array(z.string()).default([
        "staff engineer",
        "principal engineer",
        "director",
        "engineering manager",
        "head of engineering",
        "cto",
        "architect",
        "intern",
        "trainee",
        "new grad",
    ]),
    seniorYearsThreshold: z.number().default(8),
    weights: z
        .object({
        roleMatch: z.number().default(40),
        strongSkill: z.number().default(30),
        location: z.number().default(15),
        remote: z.number().default(10),
        recency: z.number().default(5),
    })
        .default({}),
    minScoreToReport: z.number().default(40),
    topN: z.number().default(10),
    dedupeFingerprint: z.enum(["company_title_location", "url", "both"]).default("both"),
    greenhouseBoards: z.array(z.string()).default([]),
    leverBoards: z.array(z.string()).default([]),
    ashbyBoards: z.array(z.string()).default([]),
    smartRecruitersBoards: z.array(z.string()).default([]),
    linkedinBoards: z.array(z.union([z.string(), z.object({ keyword: z.string(), location: z.string(), limit: z.number().optional() })])).default([]),
    jobspyBoards: z.array(z.any()).default([]),
    watchlistBoost: z.number().default(10),
    instantAlertThreshold: z.number().default(85),
    healthEnabled: z.boolean().default(true),
    healthPath: z.string().default("data/ats-health.json"),
    reportFull: z.boolean().default(true),
    maxFullReportJobs: z.number().default(150),
    includeHealthDigest: z.boolean().default(true),
    seenJobsPath: z.string().default("data/seen-jobs.json"),
    reportWindowDays: z.number().default(3),
}).passthrough();
export type AppConfig = z.infer<typeof configSchema>;
let cached: AppConfig | null = null;
export function getConfig(overrides?: Partial<AppConfig>): AppConfig {
    if (cached && !overrides)
        return cached;
    const parsed = configSchema.parse(overrides ?? {});
    if (!overrides)
        cached = parsed;
    return parsed;
}
export async function loadConfig(): Promise<AppConfig> {
    try {
        const { readFile } = await import("node:fs/promises");
        const raw = await readFile("data/config.json", "utf-8");
        const overrides = JSON.parse(raw);
        return getConfig(overrides);
    }
    catch {
        return getConfig();
    }
}
