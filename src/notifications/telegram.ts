import type { ScoredJob } from "../types.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
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
    const wl = (j as any).isWatchlist ? "⭐ " : "";
    return `${i + 1}. <b>${escapeHtml(wl + j.title)}</b>\nCompany: ${escapeHtml(j.company)}\nLocation: ${escapeHtml(j.location ?? "—")} | Match: ${j.score}%${reason}\nSkills: ${escapeHtml(skills)}${(j as any).salary ? `\nSalary: ${escapeHtml((j as any).salary)}` : ""}\n<a href="${j.url}">Apply →</a>`;
  });
  let msg = header + `\n🔥 <b>TOP MATCHES</b>\n\n` + lines.join("\n\n");
  if (msg.length > 3900) msg = msg.slice(0, 3900) + "\n… (truncated)";
  return msg;
}

export function buildMarkdownFull(jobs: ScoredJob[], stats: { period: string; found: number; newCount: number }): string {
  const header = `# 🚀 Job Hunt Report\n\n**Period:** ${stats.period}  \n**Found:** ${stats.found} relevant | **New:** ${stats.newCount} | **Total in report:** ${jobs.length}\n\n---\n`;
  if (jobs.length === 0) return header + `\n_No new high-quality matches._\n`;

  const lines = jobs.map((j, i) => {
    const wl = (j as any).isWatchlist ? "⭐ " : "";
    const salary = (j as any).salary ? ` | Salary: ${j.salary}` : "";
    const visa = (j as any).visaSupport ? ` | Visa: ${(j as any).visaSupport}` : "";
    const skills = j.matchedSkills.slice(0, 6).join(", ") || "—";
    const reasons = j.reasons.slice(0, 2).join("; ");
    const gaps = j.gaps.length ? `Gaps: ${j.gaps.slice(0, 2).join(", ")}` : "";
    const ai = (j as any).aiExplanation ? `\n> ${j.aiExplanation}` : "";
    return `## ${i + 1}. ${wl}${j.title}\n**Company:** ${j.company}  \n**Location:** ${j.location ?? "—"} | **Match:** ${j.score}%${salary}${visa}  \n**Skills:** ${skills}  \n**Why:** ${reasons}  \n${gaps ? `**${gaps}**  \n` : ""}${ai}\n**Apply:** [Apply →](${j.url})\n`;
  });

  return header + lines.join("\n---\n");
}

function chunkMarkdown(md: string, maxLen = 3800): string[] {
  if (md.length <= maxLen) return [md];
  const chunks: string[] = [];
  let current = "";
  const lines = md.split("\n");
  for (const line of lines) {
    if ((current + "\n" + line).length > maxLen) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function sendMarkdownChunks(token: string, chatId: string, md: string): Promise<void> {
  const chunks = chunkMarkdown(md, 3500);
  // Telegram Markdown: use parse_mode Markdown (not V2) for leniency, or send as plain text without parse
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isFirst = i === 0;
    const text = isFirst ? chunk : `*Continued ${i + 1}/${chunks.length}*\n\n` + chunk;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      // fallback: try without parse_mode
      const res2 = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 3900),
          disable_web_page_preview: true,
        }),
      });
      if (!res2.ok) throw new Error(`Telegram chunk ${i} failed ${res.status}: ${body}`);
    }
    // small delay to avoid rate limit
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
}

async function sendAsDocument(token: string, chatId: string, md: string, stats: { period: string; found: number; newCount: number }): Promise<boolean> {
  try {
    const blob = new Blob([md], { type: "text/markdown" });
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", blob, `job-hunt-report-${new Date().toISOString().slice(0, 10)}.md`);
    form.append("caption", `📄 Full Job Hunt Report — ${stats.period} — ${stats.found} relevant, ${stats.newCount} new\nMarkdown file with all matches`);
    form.append("parse_mode", "Markdown");
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form as any,
    });
    if (!res.ok) {
      console.warn("[telegram] sendDocument failed", await res.text());
      return false;
    }
    console.log("[telegram] Full report sent as document");
    return true;
  } catch (e) {
    console.warn("[telegram] sendDocument error", e);
    return false;
  }
}

export async function sendTelegramFull(jobs: ScoredJob[], stats: { period: string; found: number; newCount: number; topCount: number }): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[telegram] Skipped — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
    console.log(buildTelegramMessage(jobs.slice(0, 15), stats));
    console.log("\n--- FULL MARKDOWN ---\n");
    console.log(buildMarkdownFull(jobs, stats).slice(0, 3000));
    return;
  }

  // 1) Summary message (HTML) with top 5 for quick glance
  const summary = buildTelegramMessage(jobs, { ...stats, topCount: Math.min(jobs.length, 10) });
  const resSummary = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: summary,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!resSummary.ok) {
    const body = await resSummary.text();
    throw new Error(`Telegram summary failed ${resSummary.status}: ${body}`);
  }
  console.log("[telegram] Summary sent");

  if (jobs.length === 0) return;

  // 2) Full report as markdown
  const fullMd = buildMarkdownFull(jobs, stats);

  // Prefer document for large reports (>50 jobs or >4000 chars)
  if (jobs.length > 30 || fullMd.length > 4000) {
    const sentAsDoc = await sendAsDocument(token, chatId, fullMd, stats);
    if (sentAsDoc) return;
    // fallback to chunks if document fails
  }
  await sendMarkdownChunks(token, chatId, fullMd);
  console.log(`[telegram] Full report sent (${jobs.length} jobs, ${fullMd.length} chars)`);
}

// Backward compat: sendTelegram now sends full
export async function sendTelegram(jobs: ScoredJob[], stats: { period: string; found: number; newCount: number; topCount: number }): Promise<void> {
  return sendTelegramFull(jobs, stats);
}

export async function sendInstantAlert(jobs: ScoredJob[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || jobs.length === 0) return;
  const header = `⚡ <b>Instant High-Match Alert</b> — ${jobs.length} new 85%+ jobs`;
  const lines = jobs.slice(0, 5).map((j) => {
    const wl = (j as any).isWatchlist ? "⭐ " : "";
    return `• <b>${escapeHtml(wl + j.title)}</b> @ ${escapeHtml(j.company)} — ${escapeHtml(j.location ?? "—")} — ${j.score}%\n<a href="${j.url}">Apply →</a>${j.aiExplanation ? `\n<i>${escapeHtml(j.aiExplanation.slice(0, 120))}</i>` : ""}`;
  });
  const text = header + "\n\n" + lines.join("\n\n");
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  console.log(`[telegram] Instant alert sent for ${jobs.length} jobs`);
}
