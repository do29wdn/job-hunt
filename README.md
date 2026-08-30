# Job Hunter Radar

Personal cloud utility that runs on GitHub Actions — searches Greenhouse/Lever/Ashby, filters/dedupes/scores against your profile, persists seen jobs, and sends Telegram/Email digest.

**Not a SaaS.** No frontend, no auth, no DB (MVP uses `data/seen-jobs.json` committed back to repo).

## Structure

```
src/
  config.ts          # your roles/skills/locations/weights (Zod)
  types.ts           # NormalizedJob, ScoredJob, JobSource
  sources/           # greenhouse.ts, lever.ts, ashby.ts, search.ts
  pipeline/          # normalize.ts, filter.ts, dedupe.ts, score.ts
  storage/seen-jobs.ts
  notifications/     # telegram.ts, email.ts
  index.ts           # hunt + report orchestration
data/
  seen-jobs.json     # persisted + auto-committed
  config.json        # optional overrides (preferredLocations etc.)
.github/workflows/job-hunt.yml
```

## Quick start (local)

```bash
pnpm install
cp .env.example .env  # fill TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
pnpm run hunt   # discover only
pnpm run report # digest from last 3 days
pnpm start      # full pipeline
```

## Config

Edit `src/config.ts` defaults or create `data/config.json`:

```json
{
  "greenhouseBoards": ["datadog","figma"],
  "leverBoards": ["vercel"],
  "ashbyBoards": ["openai"],
  "minScoreToReport": 40,
  "topN": 10,
  "reportWindowDays": 3
}
```

Find board name from career URL: `boards.greenhouse.io/{board}` or `jobs.lever.co/{board}` or `jobs.ashbyhq.com/{board}`.

## Notifications

Set repo secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (recommended). Optional: `RESEND_API_KEY` + `RESEND_TO` for email.

Telegram setup: talk to @BotFather → `/newbot` → token; get chat ID via `getUpdates` after sending bot a message.

## Scheduling

Default: daily hunt `30 3 * * *` + every 3 days full report. Change crons in `.github/workflows/job-hunt.yml`. Simpler: single `45 3 */3 * *` for every 3 days.

Manual: Actions → Job Hunt Radar → Run workflow → pick `hunt/report/full`.

## Adding a source

Implement `JobSource` interface and add to `src/sources/search.ts`. Failures are isolated.

## Persistence

`data/seen-jobs.json` is read, updated with new fingerprints, and committed back via `git push` in workflow (requires `contents: write`). Keeps last 2000.

## Scoring (deterministic)

Role +40, strong skills +30, location +15, remote +10, recency +5 — capped 0-100, down-scored for seniority. Tune in `src/config.ts` + `src/pipeline/score.ts`.

## Future (not MVP)

AI reranking/explanations, company watchlist, application tracker.
