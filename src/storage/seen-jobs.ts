import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { NormalizedJob, ScoredJob } from "../types.js";

export async function loadSeenJobs(path: string): Promise<Map<string, NormalizedJob & { lastSeenAt: string }>> {
  try {
    const raw = await readFile(path, "utf-8");
    const arr = JSON.parse(raw) as Array<NormalizedJob & { lastSeenAt?: string }>;
    const map = new Map<string, NormalizedJob & { lastSeenAt: string }>();
    for (const j of arr) {
      map.set(j.id, { ...j, lastSeenAt: j.lastSeenAt ?? j.firstSeenAt });
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function saveSeenJobs(
  path: string,
  seen: Map<string, NormalizedJob & { lastSeenAt: string }>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const arr = [...seen.values()].sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  );
  // keep last 2000 to avoid bloat
  const trimmed = arr.slice(0, 2000);
  await writeFile(path, JSON.stringify(trimmed, null, 2) + "\n", "utf-8");
}

export function partitionNewJobs(
  candidates: NormalizedJob[],
  seen: Map<string, unknown>,
): { newJobs: NormalizedJob[]; alreadySeen: NormalizedJob[] } {
  const newJobs: NormalizedJob[] = [];
  const alreadySeen: NormalizedJob[] = [];
  for (const j of candidates) {
    if (seen.has(j.id)) alreadySeen.push(j);
    else newJobs.push(j);
  }
  return { newJobs, alreadySeen };
}

// For report mode: get jobs first seen within windowDays
export async function getJobsInWindow(
  path: string,
  windowDays: number,
): Promise<ScoredJob[]> {
  try {
    const raw = await readFile(path, "utf-8");
    const arr = JSON.parse(raw) as ScoredJob[];
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    return arr.filter((j) => new Date(j.firstSeenAt).getTime() >= cutoff);
  } catch {
    return [];
  }
}
