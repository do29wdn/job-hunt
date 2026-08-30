import type { ScoredJob } from "../types.js";
import { escapeHtml } from "../utils.js";

function sourceLabel(job: ScoredJob): string {
  const src = job.source.replace("watchlist:", "");
  if (src.startsWith("greenhouse:")) return src;
  if (src.startsWith("ashby:")) return src;
  if (src.startsWith("lever:")) return src;
  if (src.startsWith("smartrecruiters:")) return src;
  if (src.startsWith("linkedin:")) return `linkedin:${job.company}`;
  if (src.startsWith("jobspy:")) return src;
  return src;
}

function sourceSearchUrl(job: ScoredJob): string {
  const src = job.source.replace("watchlist:", "");
  if (src.startsWith("greenhouse:")) {
    const board = src.split(":")[1];
    return `https://boards.greenhouse.io/${board}`;
  }
  if (src.startsWith("ashby:")) {
    const board = src.split(":")[1];
    return `https://jobs.ashbyhq.com/${board}`;
  }
  if (src.startsWith("lever:")) {
    const board = src.split(":")[1];
    return `https://jobs.lever.co/${board}`;
  }
  if (src.startsWith("smartrecruiters:")) {
    const board = src.split(":")[1];
    return `https://jobs.smartrecruiters.com/${board}`;
  }
  if (src.startsWith("linkedin:")) return `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(job.title)}&location=${encodeURIComponent(job.location ?? "India")}`;
  if (src.startsWith("jobspy:")) return `https://www.naukri.com/${encodeURIComponent(job.title)}-jobs`;
  return job.url;
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
    const src = sourceLabel(j);
    return `${i + 1}. <b>${escapeHtml(wl + j.title)}</b>\nCompany: ${escapeHtml(j.company)} | Source: <code>${escapeHtml(src)}</code>\nLocation: ${escapeHtml(j.location ?? "—")} | Match: ${j.score}%${reason}\nSkills: ${escapeHtml(skills)}${(j as any).salary ? `\nSalary: ${escapeHtml((j as any).salary)}` : ""}\n<a href="${j.url}">Apply →</a> | <a href="${sourceSearchUrl(j)}">Search ${escapeHtml(src.split(":")[0])}</a>`;
  });
  let msg = header + `\n🔥 <b>TOP MATCHES</b>\n\n` + lines.join("\n\n");
  if (msg.length > 3900) msg = msg.slice(0, 3900) + "\n… (truncated)";
  return msg;
}

export function buildMarkdownFull(jobs: ScoredJob[], stats: { period: string; found: number; newCount: number }): string {
  const header = `# 🚀 Job Hunt Report\n\n**Period:** ${stats.period}  \n**Found:** ${stats.found} relevant | **New:** ${stats.newCount} | **Total in report:** ${jobs.length}\n**Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n\n---\n`;
  if (jobs.length === 0) return header + `\n_No new high-quality matches._\n`;

  // Quick filter index — counts per source / location for searchability
  const bySource = new Map<string, number>();
  const byLoc = new Map<string, number>();
  const bySkill = new Map<string, number>();
  for (const j of jobs) {
    const src = sourceLabel(j).split(":")[0];
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
    const locKey = (j.location ?? "unknown").split(",")[0].trim() || "unknown";
    byLoc.set(locKey, (byLoc.get(locKey) ?? 0) + 1);
    for (const s of j.matchedSkills.slice(0, 2)) bySkill.set(s, (bySkill.get(s) ?? 0) + 1);
  }
  const srcIndex = [...bySource.entries()].map(([k, v]) => `\`${k}\` (${v})`).join(" • ");
  const locIndex = [...byLoc.entries()].slice(0, 8).map(([k, v]) => `${k} (${v})`).join(" • ");
  const skillIndex = [...bySkill.entries()].slice(0, 6).map(([k, v]) => `#${k} (${v})`).join(" ");

  let md = header;
  md += `## 🔍 Quick Filter Index (searchable)\n`;
  md += `**By Source:** ${srcIndex}\n\n`;
  md += `**By Location:** ${locIndex}\n\n`;
  md += `**Top Skills:** ${skillIndex}\n\n`;
  md += `**Search tips:** \`Ctrl+F\` → \`greenhouse:stripe\` or \`Pune\` or \`#typescript\` to filter instantly\n\n---\n`;

  // Index table — searchable, copy-paste friendly
  md += `## 📋 Index — All Jobs (searchable table)\n\n`;
  md += `| # | Title | Company | Location | Score | Source | Tags |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const src = sourceLabel(j);
    const tags = j.matchedSkills.slice(0, 3).join(", ");
    const wl = (j as any).isWatchlist ? "⭐" : "";
    md += `| ${i + 1} | ${wl}${j.title.replace(/\|/g, "/")} | ${j.company} | ${j.location ?? "—"} | **${j.score}%** | \`${src}\` | ${tags} |\n`;
  }
  md += `\n---\n`;

  // Grouped detailed by source for better searchability
  const grouped = new Map<string, ScoredJob[]>();
  for (const j of jobs) {
    const key = sourceLabel(j);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(j);
  }

  md += `## 📦 Detailed by Source\n\n`;
  for (const [src, list] of grouped) {
    const searchUrl = sourceSearchUrl(list[0]);
    const srcType = src.split(":")[0];
    const icon = srcType === "greenhouse" ? "🟢" : srcType === "ashby" ? "🔵" : srcType === "lever" ? "🟡" : srcType === "linkedin" ? "🔗" : "📦";
    md += `### ${icon} ${src} — ${list.length} jobs — [Search ${srcType} →](${searchUrl})\n\n`;
    for (let i = 0; i < list.length; i++) {
      const j = list[i];
      const wl = (j as any).isWatchlist ? "⭐ " : "";
      const salary = (j as any).salary ? ` | **Salary:** ${j.salary}` : "";
      const visa = (j as any).visaSupport ? ` | **Visa:** ${(j as any).visaSupport}` : "";
      const skills = j.matchedSkills.slice(0, 6).join(", ") || "—";
      const reasons = j.reasons.slice(0, 2).join("; ");
      const gaps = j.gaps.length ? `**Gaps:** ${j.gaps.slice(0, 2).join(", ")}` : "";
      const ai = (j as any).aiExplanation ? `\n> 🤖 ${j.aiExplanation}` : "";
      const globalIdx = jobs.indexOf(j) + 1;
      md += `#### ${globalIdx}. ${wl}${j.title}\n`;
      md += `**Company:** ${j.company}  \n`;
      md += `**Location:** ${j.location ?? "—"} | **Match:** **${j.score}%** | **Source:** \`${src}\`${salary}${visa}  \n`;
      md += `**Skills:** ${skills}  \n`;
      md += `**Why:** ${reasons}  \n`;
      if (gaps) md += `${gaps}  \n`;
      if (ai) md += `${ai}  \n`;
      md += `**Tags:** #${j.matchedSkills.slice(0, 3).join(" #") || "general"} #${srcType}  \n`;
      md += `**Apply:** [Apply →](${j.url}) | [Search ${srcType}](${searchUrl}) | [Company search](https://www.google.com/search?q=${encodeURIComponent(j.company + " " + j.title)})  \n\n`;
    }
    md += `---\n\n`;
  }

  md += `> **Searchability:** Use Telegram's search or \`Ctrl+F\` in the markdown file — filter by \`${jobs[0] ? sourceLabel(jobs[0]).split(":")[0] : "source"}\`, location, or \`#skill\`. Each job shows its source for verified ATS origin.\n`;
  return md;
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
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
}

async function sendAsDocument(token: string, chatId: string, md: string, stats: { period: string; found: number; newCount: number }): Promise<boolean> {
  try {
    const blob = new Blob([md], { type: "text/markdown" });
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", blob, `job-hunt-report-${new Date().toISOString().slice(0, 10)}.md`);
    form.append("caption", `📄 Full Job Hunt Report — ${stats.period} — ${stats.found} relevant, ${stats.newCount} new\nSearchable markdown with source attribution (greenhouse/ashby/lever/linkedin/jobspy)`);
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
    console.log(buildMarkdownFull(jobs, stats).slice(0, 4000));
    return;
  }

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

  const fullMd = buildMarkdownFull(jobs, stats);

  if (jobs.length > 20 || fullMd.length > 4000) {
    const sentAsDoc = await sendAsDocument(token, chatId, fullMd, stats);
    if (sentAsDoc) return;
  }
  await sendMarkdownChunks(token, chatId, fullMd);
  console.log(`[telegram] Full report sent (${jobs.length} jobs, ${fullMd.length} chars)`);
}

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
    const src = sourceLabel(j);
    return `• <b>${escapeHtml(wl + j.title)}</b> @ ${escapeHtml(j.company)} — ${escapeHtml(j.location ?? "—")} — ${j.score}% | <code>${escapeHtml(src)}</code>\n<a href="${j.url}">Apply →</a> | <a href="${sourceSearchUrl(j)}">Source</a>${j.aiExplanation ? `\n<i>${escapeHtml(j.aiExplanation.slice(0, 120))}</i>` : ""}`;
  });
  const text = header + "\n\n" + lines.join("\n\n");
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  console.log(`[telegram] Instant alert sent for ${jobs.length} jobs`);
}
