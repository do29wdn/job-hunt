import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type BoardHealth = {
  board: string; // e.g. "greenhouse:stripe"
  success: number;
  fail: number;
  consecutiveFails: number;
  lastSuccess?: string;
  lastFail?: string;
  lastLatencyMs?: number;
  lastJobCount?: number;
  disabledUntil?: string; // ISO if auto-disabled
  avgJobs?: number;
};

export type HealthStore = Record<string, BoardHealth>;

const HEALTH_PATH = "data/ats-health.json";
const FAIL_THRESHOLD = 3; // disable after 3 consecutive fails
const DISABLE_DAYS = 7;
const STALE_DAYS = 5; // no jobs for 5 runs = flag

export async function loadHealth(): Promise<HealthStore> {
  try {
    const raw = await readFile(HEALTH_PATH, "utf-8");
    return JSON.parse(raw) as HealthStore;
  } catch {
    return {};
  }
}

export async function saveHealth(store: HealthStore): Promise<void> {
  await mkdir(dirname(HEALTH_PATH), { recursive: true });
  await writeFile(HEALTH_PATH, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

export function isDisabled(health: BoardHealth): boolean {
  if (!health.disabledUntil) return false;
  return new Date(health.disabledUntil).getTime() > Date.now();
}

export function shouldSkip(board: string, store: HealthStore): boolean {
  const h = store[board];
  if (!h) return false;
  if (isDisabled(h)) return true;
  return false;
}

export function recordSuccess(store: HealthStore, board: string, jobCount: number, latencyMs: number): void {
  const h = store[board] ?? { board, success: 0, fail: 0, consecutiveFails: 0 };
  h.success++;
  h.consecutiveFails = 0;
  h.lastSuccess = new Date().toISOString();
  h.lastLatencyMs = latencyMs;
  h.lastJobCount = jobCount;
  h.avgJobs = h.avgJobs ? Math.round((h.avgJobs * 0.7 + jobCount * 0.3)) : jobCount;
  // auto-re-enable if previously disabled and now succeeded
  if (h.disabledUntil) delete h.disabledUntil;
  store[board] = h;
}

export function recordFail(store: HealthStore, board: string, error: string, latencyMs?: number): void {
  const h = store[board] ?? { board, success: 0, fail: 0, consecutiveFails: 0 };
  h.fail++;
  h.consecutiveFails++;
  h.lastFail = new Date().toISOString();
  if (latencyMs) h.lastLatencyMs = latencyMs;
  if (h.consecutiveFails >= FAIL_THRESHOLD) {
    const until = new Date(Date.now() + DISABLE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    h.disabledUntil = until;
    console.warn(`[health] disabling ${board} until ${until} after ${h.consecutiveFails} fails (${error})`);
  }
  store[board] = h;
}

export function buildHealthMarkdown(store: HealthStore): string {
  const entries = Object.values(store).sort((a, b) => b.fail - a.fail);
  if (entries.length === 0) return "No health data yet.";
  const disabled = entries.filter(isDisabled);
  const failing = entries.filter((e) => e.consecutiveFails > 0 && !isDisabled(e));
  const stale = entries.filter((e) => (e.avgJobs ?? e.lastJobCount ?? 1) === 0);

  let md = `# 🩺 ATS Health — ${new Date().toISOString().slice(0, 10)}\n\n`;
  md += `Total boards tracked: ${entries.length} | Disabled: ${disabled.length} | Failing: ${failing.length} | Stale (0 jobs): ${stale.length}\n\n`;
  if (disabled.length) {
    md += `## 🔴 Disabled (auto, retry in ${DISABLE_DAYS}d)\n`;
    for (const h of disabled) md += `- \`${h.board}\` — fails ${h.consecutiveFails}, last fail ${h.lastFail?.slice(0, 10)} → until ${h.disabledUntil?.slice(0, 10)}\n`;
    md += "\n";
  }
  if (failing.length) {
    md += `## 🟡 Failing\n`;
    for (const h of failing) md += `- \`${h.board}\` — ${h.consecutiveFails}x fails, last ${h.lastFail?.slice(0, 10)}, success ${h.success}\n`;
    md += "\n";
  }
  if (stale.length) {
    md += `## ⚪ Stale (0 jobs last fetch)\n`;
    for (const h of stale.slice(0, 10)) md += `- \`${h.board}\` — avg ${h.avgJobs ?? 0}, last ${h.lastJobCount ?? 0} jobs\n`;
    if (stale.length > 10) md += `- ... and ${stale.length - 10} more\n`;
    md += "\n";
  }
  md += `## 📊 All boards\n| Board | ✅ | ❌ | streak | last jobs | avg | latency |\n|---|---|---|---|---|---|---|\n`;
  for (const h of entries.slice(0, 50)) {
    const status = isDisabled(h) ? "🔴" : h.consecutiveFails ? "🟡" : "🟢";
    md += `| ${status} \`${h.board}\` | ${h.success} | ${h.fail} | ${h.consecutiveFails} | ${h.lastJobCount ?? "-"} | ${h.avgJobs ?? "-"} | ${h.lastLatencyMs ? `${h.lastLatencyMs}ms` : "-"} |\n`;
  }
  if (entries.length > 50) md += `\n_... ${entries.length - 50} more boards_\n`;
  return md;
}
