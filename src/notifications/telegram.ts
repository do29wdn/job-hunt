import type { ScoredJob } from "../types.js";
import { escapeHtml, escapeAttr } from "../utils.js";
function sourceLabel(job: ScoredJob): string {
    const src = job.source.replace("watchlist:", "");
    if (src.startsWith("linkedin:"))
        return `linkedin:${job.company}`;
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
    if (src.startsWith("linkedin:")) {
        return `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(job.title)}&location=${encodeURIComponent(job.location ?? "India")}`;
    }
    if (src.startsWith("jobspy:")) {
        const slug = job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        return `https://www.naukri.com/${slug}-jobs`;
    }
    return job.url;
}
export function buildTelegramMessage(jobs: ScoredJob[], stats: {
    period: string;
    found: number;
    newCount: number;
    topCount: number;
}): string {
    const header = `🚀 <b>Job Hunt Report</b>\n\nPeriod: ${escapeHtml(stats.period)}\nFound: ${stats.found} relevant | New: ${stats.newCount} | High-confidence: ${stats.topCount}\n`;
    if (jobs.length === 0) {
        return header + `\nNo new high-quality matches in this period. Pipeline ran successfully — check logs for dropped/filtered counts.`;
    }
    const top = jobs.slice(0, 10);
    const lines = top.map((j, i) => {
        const skills = j.matchedSkills.slice(0, 5).join(" • ") || "—";
        const reason = j.reasons[0] ? `\n<i>${escapeHtml(j.reasons[0])}</i>` : "";
        const wl = j.isWatchlist ? "⭐ " : "";
        const src = sourceLabel(j);
        return `${i + 1}. <b>${escapeHtml(wl + j.title)}</b>\nCompany: ${escapeHtml(j.company)} | Source: <code>${escapeHtml(src)}</code>\nLocation: ${escapeHtml(j.location ?? "—")} | Match: ${j.score}%${reason}\nSkills: ${escapeHtml(skills)}${j.salary ? `\nSalary: ${escapeHtml(j.salary)}` : ""}\n<a href="${escapeAttr(j.url)}">Apply →</a> | <a href="${escapeAttr(sourceSearchUrl(j))}">Search ${escapeHtml(src.split(":")[0])}</a>`;
    });
    let msg = header + `\n🔥 <b>TOP MATCHES</b>\n\n` + lines.join("\n\n");
    if (msg.length > 3900)
        msg = msg.slice(0, 3900) + "\n… (truncated)";
    return msg;
}
function mdCell(s: string): string {
    return s.replace(/\|/g, "/").replace(/\n/g, " ");
}
export function buildMarkdownFull(jobs: ScoredJob[], stats: {
    period: string;
    found: number;
    newCount: number;
}): string {
    const header = `# 🚀 Job Hunt Report\n\n**Period:** ${stats.period}  \n**Found:** ${stats.found} relevant | **New:** ${stats.newCount} | **Total in report:** ${jobs.length}\n**Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n\n---\n`;
    if (jobs.length === 0)
        return header + `\n_No new high-quality matches._\n`;
    const bySource = new Map<string, number>();
    const byLoc = new Map<string, number>();
    const bySkill = new Map<string, number>();
    for (const j of jobs) {
        const src = sourceLabel(j).split(":")[0];
        bySource.set(src, (bySource.get(src) ?? 0) + 1);
        const locKey = (j.location ?? "unknown").split(",")[0].trim() || "unknown";
        byLoc.set(locKey, (byLoc.get(locKey) ?? 0) + 1);
        for (const s of j.matchedSkills.slice(0, 2))
            bySkill.set(s, (bySkill.get(s) ?? 0) + 1);
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
    md += `## 📋 Index — All Jobs (searchable table)\n\n`;
    md += `| # | Title | Company | Location | Score | Source | Tags |\n`;
    md += `|---|---|---|---|---|---|---|\n`;
    for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        const src = sourceLabel(j);
        const tags = j.matchedSkills.slice(0, 3).join(", ");
        const wl = j.isWatchlist ? "⭐" : "";
        md += `| ${i + 1} | ${wl}${mdCell(j.title)} | ${mdCell(j.company)} | ${mdCell(j.location ?? "—")} | **${j.score}%** | \`${mdCell(src)}\` | ${mdCell(tags)} |\n`;
    }
    md += `\n---\n`;
    const grouped = new Map<string, ScoredJob[]>();
    for (const j of jobs) {
        const key = sourceLabel(j);
        if (!grouped.has(key))
            grouped.set(key, []);
        grouped.get(key)!.push(j);
    }
    md += `## 📦 Detailed by Source\n\n`;
    for (const [src, list] of grouped) {
        const searchUrl = sourceSearchUrl(list[0]);
        const srcType = src.split(":")[0];
        const icon = srcType === "greenhouse" ? "🟢" : srcType === "ashby" ? "🔵" : srcType === "lever" ? "🟡" : srcType === "linkedin" ? "🔗" : "📦";
        md += `### ${icon} ${src} — ${list.length} jobs — [Search ${srcType} →](${searchUrl})\n\n`;
        for (const j of list) {
            const wl = j.isWatchlist ? "⭐ " : "";
            const salary = j.salary ? ` | **Salary:** ${mdCell(j.salary)}` : "";
            const visa = j.visaSupport ? ` | **Visa:** ${mdCell(j.visaSupport)}` : "";
            const skills = j.matchedSkills.slice(0, 6).join(", ") || "—";
            const reasons = j.reasons.slice(0, 2).join("; ");
            const gaps = j.gaps.length ? `**Gaps:** ${mdCell(j.gaps.slice(0, 2).join(", "))}` : "";
            const ai = j.aiExplanation ? `\n> 🤖 ${mdCell(j.aiExplanation)}` : "";
            const globalIdx = jobs.indexOf(j) + 1;
            md += `#### ${globalIdx}. ${wl}${mdCell(j.title)}\n`;
            md += `**Company:** ${mdCell(j.company)}  \n`;
            md += `**Location:** ${mdCell(j.location ?? "—")} | **Match:** **${j.score}%** | **Source:** \`${mdCell(src)}\`${salary}${visa}  \n`;
            md += `**Skills:** ${mdCell(skills)}  \n`;
            md += `**Why:** ${mdCell(reasons)}  \n`;
            if (gaps)
                md += `${gaps}  \n`;
            if (ai)
                md += `${ai}  \n`;
            md += `**Tags:** #${j.matchedSkills.slice(0, 3).join(" #") || "general"} #${srcType}  \n`;
            md += `**Apply:** [Apply →](${j.url}) | [Search ${srcType}](${searchUrl}) | [Company search](https://www.google.com/search?q=${encodeURIComponent(j.company + " " + j.title)})  \n\n`;
        }
        md += `---\n\n`;
    }
    md += `> **Searchability:** Use Telegram's search or \`Ctrl+F\` in the markdown file — filter by \`${jobs[0] ? sourceLabel(jobs[0]).split(":")[0] : "source"}\`, location, or \`#skill\`. Each job shows its source for verified ATS origin.\n`;
    return md;
}
function chunkMarkdown(md: string, maxLen = 3800): string[] {
    if (md.length <= maxLen)
        return [md];
    const chunks: string[] = [];
    let current = "";
    for (const line of md.split("\n")) {
        let l = line;
        while (l.length > maxLen) {
            if (current) {
                chunks.push(current);
                current = "";
            }
            chunks.push(l.slice(0, maxLen));
            l = l.slice(maxLen);
        }
        if ((current + "\n" + l).length > maxLen) {
            chunks.push(current);
            current = l;
        }
        else {
            current += (current ? "\n" : "") + l;
        }
    }
    if (current)
        chunks.push(current);
    return chunks.filter((c) => c.length > 0);
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
            signal: AbortSignal.timeout(30000),
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
                signal: AbortSignal.timeout(30000),
            });
            if (!res2.ok) {
                throw new Error(`Telegram chunk ${i} failed ${res2.status}: ${await res2.text()} (original ${res.status}: ${body.slice(0, 200)})`);
            }
        }
        if (i < chunks.length - 1)
            await new Promise((r) => setTimeout(r, 400));
    }
}
async function sendAsDocument(token: string, chatId: string, md: string, stats: {
    period: string;
    found: number;
    newCount: number;
}): Promise<boolean> {
    try {
        const blob = new Blob([md], { type: "text/markdown" });
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("document", blob, `job-hunt-report-${new Date().toISOString().slice(0, 10)}.md`);
        form.append("caption", `📄 Full Job Hunt Report — ${stats.period} — ${stats.found} relevant, ${stats.newCount} new\nSearchable markdown with source attribution (greenhouse/ashby/lever/linkedin/jobspy)`);
        const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
            method: "POST",
            body: form as any,
            signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
            console.warn("[telegram] sendDocument failed", await res.text());
            return false;
        }
        console.log("[telegram] Full report sent as document");
        return true;
    }
    catch (e) {
        console.warn("[telegram] sendDocument error", e);
        return false;
    }
}
export async function sendTelegramFull(jobs: ScoredJob[], stats: {
    period: string;
    found: number;
    newCount: number;
    topCount: number;
}): Promise<void> {
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
        signal: AbortSignal.timeout(30000),
    });
    if (!resSummary.ok) {
        const body = await resSummary.text();
        throw new Error(`Telegram summary failed ${resSummary.status}: ${body}`);
    }
    console.log("[telegram] Summary sent");
    if (jobs.length === 0)
        return;
    const fullMd = buildMarkdownFull(jobs, stats);
    if (jobs.length > 20 || fullMd.length > 4000) {
        const sentAsDoc = await sendAsDocument(token, chatId, fullMd, stats);
        if (sentAsDoc)
            return;
    }
    await sendMarkdownChunks(token, chatId, fullMd);
    console.log(`[telegram] Full report sent (${jobs.length} jobs, ${fullMd.length} chars)`);
}
export async function sendTelegram(jobs: ScoredJob[], stats: {
    period: string;
    found: number;
    newCount: number;
    topCount: number;
}): Promise<void> {
    return sendTelegramFull(jobs, stats);
}
export async function sendInstantAlert(jobs: ScoredJob[], threshold = 85): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId || jobs.length === 0)
        return;
    const shown = jobs.slice(0, 5);
    const header = `⚡ <b>Instant High-Match Alert</b> — ${jobs.length} new jobs ≥ ${threshold}%`;
    const lines = shown.map((j) => {
        const wl = j.isWatchlist ? "⭐ " : "";
        const src = sourceLabel(j);
        return `• <b>${escapeHtml(wl + j.title)}</b> @ ${escapeHtml(j.company)} — ${escapeHtml(j.location ?? "—")} — ${j.score}% | <code>${escapeHtml(src)}</code>\n<a href="${escapeAttr(j.url)}">Apply →</a> | <a href="${escapeAttr(sourceSearchUrl(j))}">Source</a>${j.aiExplanation ? `\n<i>${escapeHtml(j.aiExplanation.slice(0, 120))}</i>` : ""}`;
    });
    const more = jobs.length > shown.length ? `\n\n…and ${jobs.length - shown.length} more in the full report` : "";
    const text = header + "\n\n" + lines.join("\n\n") + more;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: text.slice(0, 3900),
            parse_mode: "HTML",
            disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok)
        throw new Error(`Telegram instant alert failed ${res.status}: ${await res.text()}`);
    console.log(`[telegram] Instant alert sent for ${jobs.length} jobs`);
}
