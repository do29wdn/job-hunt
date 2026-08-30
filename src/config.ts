import { z } from "zod";

const configSchema = z.object({
  // --- search ---
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
  // title keywords that broaden matching (product engineer, web engineer etc.)
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
  // strong signal skills (higher weight)
  strongSkills: z.array(z.string()).default([
    "typescript",
    "react",
    "node.js",
    "nodejs",
    "postgresql",
  ]),

  // --- location ---
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
  // allow remote globally but Indian candidate eligible — treated as +10 not +15
  remoteGlobalAllowed: z.boolean().default(true),

  // --- experience filtering ---
  // if title/description contains these, filter out (configurable, not aggressive)
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
  // if description explicitly says 8+ years, flag but don't auto-drop unless blocklist hit
  // we use this only for down-scoring, not hard filter
  seniorYearsThreshold: z.number().default(8),

  // --- scoring weights (0-100) ---
  weights: z
    .object({
      roleMatch: z.number().default(40),
      strongSkill: z.number().default(30),
      location: z.number().default(15),
      remote: z.number().default(10),
      recency: z.number().default(5),
    })
    .default({}),

  // --- pipeline ---
  minScoreToReport: z.number().default(40),
  topN: z.number().default(10),
  dedupeFingerprint: z.enum(["company_title_location", "url", "both"]).default("both"),

  // --- sources ---
  // ATS boards to check — add/remove as needed
  greenhouseBoards: z.array(z.string()).default([
    // example boards — replace with your target companies
    // "datadog", "stripe", "notion"
  ]),
  leverBoards: z.array(z.string()).default([]),
  ashbyBoards: z.array(z.string()).default([]),

  // --- persistence ---
  seenJobsPath: z.string().default("data/seen-jobs.json"),

  // --- report ---
  reportWindowDays: z.number().default(3),
});

export type AppConfig = z.infer<typeof configSchema>;

// Allow overrides via config file or env — simple merge
let cached: AppConfig | null = null;

export function getConfig(overrides?: Partial<AppConfig>): AppConfig {
  if (cached && !overrides) return cached;
  const parsed = configSchema.parse(overrides ?? {});
  if (!overrides) cached = parsed;
  return parsed;
}

// For GitHub Actions you can optionally load overrides from data/config.json
export async function loadConfig(): Promise<AppConfig> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile("data/config.json", "utf-8");
    const overrides = JSON.parse(raw);
    return getConfig(overrides);
  } catch {
    return getConfig();
  }
}
