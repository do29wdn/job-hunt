import type { ScoredJob } from "../types.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildTelegramMessage(jobs: ScoredJob[], stats: { period: string; found: number; newCount: number; topCount: number }): string {
  const header = `🚀 <b>Job Hunt Report</b>\n\nPeriod: ${escapeHtml(stats.period)}\nFound: ${stats.found} relevant | New: ${stats.newCount} | High-confidence: ${stats.topCount}\n`;

  if (jobs.length === 0) {
    return header + `\nNo new high-quality matches in this period. Pipeline ran successfully — check logs for dropped/filtered counts.`;
  }

  const top = jobs.slice(0, 10);
  const lines = top.map((j, i) => {
    const skills = j.matchedSkills.slice(0, 5).join(" • ") || "—";
    const reason = j.reasons[0] ? `\n<i>${escapeHtml(j.reasons[0])}</i>` : "";
    return `${i + 1}. <b>${escapeHtml(j.title)}</b>\nCompany: ${escapeHtml(j.company)}\nLocation: ${escapeHtml(j.location ?? "—")} | Match: ${j.score}%${reason}\nSkills: ${escapeHtml(skills)}\n<a href="${j.url}">Apply →</a>`;
  });

  // Telegram limit 4096 chars
  let msg = header + `\n🔥 <b>TOP MATCHES</b>\n\n` + lines.join("\n\n");
  if (msg.length > 3900) msg = msg.slice(0, 3900) + "\n… (truncated)";
  return msg;
}

export async function sendTelegram(jobs: ScoredJob[], stats: { period: string; found: number; newCount: number; topCount: number }): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[telegram] Skipped — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
    console.log(buildTelegramMessage(jobs, stats));
    return;
  }

  const text = buildTelegramMessage(jobs, stats);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram failed ${res.status}: ${body}`);
  }
  console.log("[telegram] Report sent");
}
