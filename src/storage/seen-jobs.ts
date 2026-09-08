import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { NormalizedJob, ScoredJob } from "../types.js";
export type StoredJob = NormalizedJob & Partial<ScoredJob> & {
    lastSeenAt: string;
};
export async function loadSeenJobs(path: string): Promise<Map<string, StoredJob>> {
    try {
        const raw = await readFile(path, "utf-8");
        const arr = JSON.parse(raw) as Array<StoredJob & {
            lastSeenAt?: string;
        }>;
        const map = new Map<string, StoredJob>();
        for (const j of arr) {
            if (!j?.id)
                continue;
            const id = j.id.replace(/\s+/g, " ").trim();
            map.set(id, { ...j, id, lastSeenAt: j.lastSeenAt ?? j.firstSeenAt });
        }
        return map;
    }
    catch {
        return new Map();
    }
}
export async function saveSeenJobs(path: string, seen: Map<string, StoredJob>): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const arr = [...seen.values()]
        .map(({ description, ...rest }) => rest)
        .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    const trimmed = arr.slice(0, 2000);
    await writeFile(path, JSON.stringify(trimmed, null, 2) + "\n", "utf-8");
}
export function partitionNewJobs(candidates: NormalizedJob[], seen: Map<string, unknown>): {
    newJobs: NormalizedJob[];
    alreadySeen: NormalizedJob[];
} {
    const newJobs: NormalizedJob[] = [];
    const alreadySeen: NormalizedJob[] = [];
    for (const j of candidates) {
        if (seen.has(j.id))
            alreadySeen.push(j);
        else
            newJobs.push(j);
    }
    return { newJobs, alreadySeen };
}
