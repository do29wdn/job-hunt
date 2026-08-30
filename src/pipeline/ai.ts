import type { ScoredJob } from "../types.js";

type AiResult = {
  explanation: string;
  gaps?: string;
  adjustedScore?: number;
};

/**
 * Optional AI — key-gated heavy, not AI-first.
 * - No key → deterministic only, zero cost
 * - Key provided → deterministic runs first, then AI does heavy deep work (semantic scoring + NER) for all relevant jobs, blended, fallback on fail
 */
export async function enrichWithAI(jobs: ScoredJob[], max = 10): Promise<ScoredJob[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || jobs.length === 0) return jobs;

  const toEnrich = jobs.slice(0, max);
  const rest = jobs.slice(max);

  const enriched = await Promise.all(
    toEnrich.map(async (job) => enrichOne(job, key)),
  );

  return [...enriched, ...rest].sort((a, b) => b.score - a.score);
}

// Heavy: enriches ALL jobs when key exists — batch-concurrent, rate-limited, fallback safe
export async function enrichWithAIHeavy(jobs: ScoredJob[], max = 150): Promise<ScoredJob[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || jobs.length === 0) return jobs;

  const toEnrich = jobs.slice(0, max);
  const rest = jobs.slice(max);
  console.log(`[ai-heavy] enriching ${toEnrich.length}/${jobs.length} jobs via ${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}:${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`);

  const batchSize = 5;
  const enriched: ScoredJob[] = [];
  for (let i = 0; i < toEnrich.length; i += batchSize) {
    const batch = toEnrich.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((job) => enrichOne(job, key)));
    enriched.push(...results);
    if (i + batchSize < toEnrich.length) await new Promise((r) => setTimeout(r, 600)); // rate limit
  }
  console.log(`[ai-heavy] done ${enriched.length}, fallback ${toEnrich.length - enriched.filter((j) => (j as any).aiExplanation).length} without AI`);

  return [...enriched, ...rest].sort((a, b) => b.score - a.score);
}

async function enrichOne(job: ScoredJob, key: string): Promise<ScoredJob> {
  try {
    const prompt = `You are a job matching assistant for a Full Stack Developer (React, TypeScript, Node.js, PostgreSQL, Tailwind, Hono, Drizzle) — fresher India, open to remote India.
Job: ${job.title} at ${job.company} — Location: ${job.location ?? "unknown"} — Source: ${job.source}
Description: ${(job.description ?? "").slice(0, 1800)}
Current deterministic: score ${job.score}, matchedSkills: ${job.matchedSkills.join(", ")}, reasons: ${job.reasons.join("; ")}, gaps: ${job.gaps.join("; ")}
Task: Deeply analyze semantic relevance (not just keywords), extract required skills NER, decide if duplicate seniority mismatch, and give adjustedScore 0-100.
Return JSON: {"explanation": "1-2 sentences why relevant or not (semantic)", "gaps": "missing skills comma-separated or empty", "adjustedScore": 0-100 integer}
Only JSON, no markdown.`;

    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const url = `${base.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 220,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) throw new Error(`AI ${res.status}`);
    const data = (await res.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("no content");
    const parsed = JSON.parse(content) as AiResult;
    return {
      ...job,
      aiExplanation: parsed.explanation?.slice(0, 320),
      gaps: parsed.gaps ? [...job.gaps, parsed.gaps] : job.gaps,
      score: parsed.adjustedScore ? Math.round((job.score * 0.6 + parsed.adjustedScore * 0.4)) : job.score, // 60% deterministic + 40% AI
    } as ScoredJob;
  } catch (e) {
    console.warn(`[ai] failed for ${job.title}:`, (e as Error).message);
    return job;
  }
}
