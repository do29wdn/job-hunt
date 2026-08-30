import type { ScoredJob } from "../types.js";

type AiResult = {
  explanation: string;
  gaps?: string;
  adjustedScore?: number;
};

/**
 * Optional AI reranker — only runs if OPENAI_API_KEY is set.
 * Uses gpt-4o-mini or similar cheap model to explain why job is relevant.
 * Falls back to deterministic reasons if not configured or fails.
 */
export async function enrichWithAI(jobs: ScoredJob[], max = 10): Promise<ScoredJob[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || jobs.length === 0) return jobs;

  const toEnrich = jobs.slice(0, max);
  const rest = jobs.slice(max);

  const enriched = await Promise.all(
    toEnrich.map(async (job) => {
      try {
        const prompt = `You are a job matching assistant for a Full Stack Developer (React, TypeScript, Node.js, PostgreSQL, Tailwind, Hono, Drizzle). 
Job: ${job.title} at ${job.company} — Location: ${job.location ?? "unknown"}
Description: ${(job.description ?? "").slice(0, 1500)}
Current score: ${job.score}, matchedSkills: ${job.matchedSkills.join(", ")}, reasons: ${job.reasons.join("; ")}, gaps: ${job.gaps.join("; ")}
Return JSON: {"explanation": "1-2 sentences why relevant or not", "gaps": "missing skills comma-separated or empty", "adjustedScore": 0-100 integer}
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
            max_tokens: 200,
            response_format: { type: "json_object" },
          }),
        });

        if (!res.ok) throw new Error(`OpenAI ${res.status}`);
        const data = (await res.json()) as any;
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error("no content");
        const parsed = JSON.parse(content) as AiResult;
        return {
          ...job,
          aiExplanation: parsed.explanation?.slice(0, 300),
          gaps: parsed.gaps ? [...job.gaps, parsed.gaps] : job.gaps,
          // optionally blend score: average deterministic + AI
          score: parsed.adjustedScore ? Math.round((job.score + parsed.adjustedScore) / 2) : job.score,
        } as ScoredJob;
      } catch (e) {
        console.warn(`[ai] failed for ${job.title}:`, (e as Error).message);
        return job;
      }
    }),
  );

  // re-sort after AI adjustment
  return [...enriched, ...rest].sort((a, b) => b.score - a.score);
}
