import { readFile } from "node:fs/promises";
export async function loadDotEnv(path = ".env"): Promise<void> {
    let raw: string;
    try {
        raw = await readFile(path, "utf-8");
    }
    catch {
        return;
    }
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m)
            continue;
        const [, key, rawVal] = m;
        let val = rawVal.trim();
        if (!val.startsWith('"') && !val.startsWith("'")) {
            const idx = val.indexOf(" #");
            if (idx > 0)
                val = val.slice(0, idx).trim();
        }
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        const existing = process.env[key];
        if (existing === undefined || existing === "") {
            process.env[key] = val;
        }
    }
}
export function isDryRun(): boolean {
    return process.env.DRY_RUN === "true";
}
