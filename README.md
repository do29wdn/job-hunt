<div align="center">

[![Typing SVG](https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=22&pause=1000&color=00D1FF&center=true&vCenter=true&width=700&lines=Job+Hunt+Radar+%F0%9F%9A%80;Your+personal+job-hunting+autopilot;No+dashboard.+No+auth.+Just+jobs.)](https://git.io/typing-svg)

<p>
  <img src="https://img.shields.io/github/actions/workflow/status/do29wdn/job-hunt/job-hunt.yml?style=for-the-badge&logo=githubactions&label=radar" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white" />
  <img src="https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" />
</p>

<p>
  <b>Searches 65+ boards → filters → dedupes → scores → pings you on Telegram</b><br>
  Runs entirely on <code>GitHub Actions</code>. Sleeps on your laptop.
</p>

[✨ Use as template](https://github.com/do29wdn/job-hunt/generate) • [⚡ Quick start](#-quick-start-30s) • [🧠 How it works](#-how-it-works) • [🔧 Config](#-fully-dynamic-config)

</div>

---

<div align="center">

```mermaid
flowchart LR
  A[GitHub Actions<br/>cron 03:30 UTC] --> B[TypeScript<br/>job-hunter]
  B --> C[65+ Boards<br/>Greenhouse/Lever/Ashby<br/>+ LinkedIn/Naukri]
  C --> D[Normalize → Filter<br/>→ Dedupe → Score]
  D --> E{Seen?}
  E -- new --> F[Telegram<br/>Full Markdown +<br/>Instant 85%+ alerts]
  E -- seen --> G[(data/seen-jobs.json<br/>auto-committed)]
  F --> G
```

</div>

### 🎯 What this is

> **Not a SaaS. Not a dashboard.** A boring, reliable cloud utility that feels like a personal job-hunting assistant.

It quietly wakes up, searches *everywhere* you care about, removes duplicates and noise, remembers what you’ve seen, and tells you:

> “Here are the new jobs you should actually look at.”

Perfect for **Pune / Remote India / Global remote** Full Stack (`React • TypeScript • Node.js • PostgreSQL`).

---

### ⚡ Quick start (30s)

```bash
# 1. Clone as template
git clone https://github.com/do29wdn/job-hunt.git && cd job-hunt

# 2. Install
pnpm install

# 3. Telegram (recommended)
cp .env.example .env
# → talk to @BotFather on Telegram → /newbot → token
# → send hi to your bot → https://api.telegram.org/bot<TOKEN>/getUpdates → chat.id

# 4. Run locally
pnpm run hunt      # discover only
pnpm run report    # digest last 3 days
pnpm start         # full pipeline (hunt + report)

# 5. Cloud: add secrets in GitHub → Settings → Secrets → Actions
# TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (and optional OPENAI_API_KEY)
# → Actions → Job Hunt Radar → Run workflow → full
```

---

### 🔥 Live demo

<div align="center">

![Demo](https://img.shields.io/badge/demo-Telegram_report-26A5E4?style=for-the-badge)

```md
# 🚀 Job Hunt Report
**Period:** Last 3 days | **Found:** 1118 relevant | **New:** 1118

## 1. ⭐ Senior Software Engineer, Quality Engineering
**Company:** plane | **Location:** United States | **Match:** 98%
**Skills:** typescript • react • node.js • postgres | **Salary:** $130k
**Why:** Role matches + Strong skills: typescript, react
**Apply:** https://jobs.ashbyhq.com/plane/...

## 2. Software Engineer, Integrations Platform @ vanta
**Location:** Remote U.S. | **Match:** 98% | **Visa:** sponsorship
**Apply:** https://jobs.ashbyhq.com/vanta/...
```

*Full markdown doc sent as Telegram file when >30 jobs. Instant alerts for 85%+ (watchlist 80%+) arrive separately.*

</div>

---

### 🧠 How it works

| Stage | File | What it does |
|---|---|---|
| **Search** | `src/sources/search.ts` | 65 boards parallel (`Promise.allSettled`, isolated). Health skips disabled boards. |
| **Normalize** | `src/pipeline/normalize.ts` | `company|title|location` fingerprint, all sources → `NormalizedJob` |
| **Filter** | `src/pipeline/filter.ts` | Role aliases, location prefs, seniority blocklist (`intern`/`staff`/`principal`) |
| **Dedupe** | `src/pipeline/dedupe.ts` | Fingerprint + URL + externalId, watchlist-preferred |
| **Score** | `src/pipeline/score.ts` | Role 40 + strongSkills 30 + location 15 + remote 10 + recency 5 + visa/IST/watchlist bonuses, capped 0-100 |
| **AI (opt)** | `src/pipeline/ai.ts` | If `OPENAI_API_KEY` set, reranks top 15 with explanation |
| **Store** | `src/storage/seen-jobs.ts` | `data/seen-jobs.json` + `data/ats-health.json` auto-committed back to repo |
| **Notify** | `src/notifications/telegram.ts` | Summary HTML + full Markdown doc (chunked) + instant alerts |

**Sources (fully dynamic via config):**
- **Greenhouse 30:** `databricks`, `anthropic`, `stripe`, `gitlab`, … `boards-api.greenhouse.io/v1/boards/{board}/jobs`
- **Ashby 15:** `openai`, `airwallex`, `notion`, `cursor`, … `api.ashbyhq.com/posting-api/job-board/{board}`
- **Lever 1:** `spotify` `api.lever.co/v0/postings/{board}`
- **SmartRecruiters:** optional `api.smartrecruiters.com/v1/companies/{board}/postings`
- **LinkedIn 4:** via `open-linkedin-jobs` + guest API fallback `jobs-guest/jobs/api/seeMoreJobPostings/search`
- **JobSpy 2:** `naukri` + `linkedin`/`indeed` via `python-jobspy` bridge `src/sources/jobspy.ts`

---

### 🔧 Fully dynamic config

No code change needed — edit `data/config.json`:

```json
{
  "greenhouseBoards": ["databricks","anthropic","gitlab"],
  "ashbyBoards": ["openai","notion"],
  "linkedinBoards": ["Full Stack Developer @ Pune, India", "React Developer @ Remote"],
  "jobspyBoards": [{ "site": ["naukri","linkedin"], "searchTerm": "Full Stack", "location": "Pune, India", "resultsWanted": 20 }],
  "preferredLocations": ["pune","remote india","mumbai","bengaluru","remote","usa","london"],
  "roles": ["Full Stack Developer","React Developer"],
  "skills": ["typescript","react","node.js"],
  "minScoreToReport": 40,
  "topN": 15,
  "reportFull": true,
  "maxFullReportJobs": 150,
  "healthEnabled": true
}
```

Watchlist (high-priority +10 boost) in `data/watchlist.json`:
```json
{"companies": [{"slug":"vercel","ats":"greenhouse"}, {"slug":"linear","ats":"ashby"}]}
```

All keys are `passthrough` — add anything, it just works.

---

### 🩺 Self-healing

`data/ats-health.json` tracks per-board `success/fail/latency/avgJobs`. After 3 consecutive fails → auto-disabled 7 days, skipped in next runs. Stale (0 jobs when avg >5) flagged. Weekly digest sent to Telegram on Sundays as `ats-health-YYYY-MM-DD.md`.

```bash
cat data/ats-health.json | jq
# health digest auto-sent, no manual tuning
```

---

### 🔔 Notifications

**Telegram (recommended):**
```bash
# 1. @BotFather → /newbot → copy TELEGRAM_BOT_TOKEN
# 2. Send hi to your bot
# 3. https://api.telegram.org/bot<TOKEN>/getUpdates → chat.id = TELEGRAM_CHAT_ID
# 4. Add both as GitHub Secrets
```

**Email (optional):** `RESEND_API_KEY` + `RESEND_TO` or `SMTP_*` + `EMAIL_TO`.

**AI explanations (optional):** add `OPENAI_API_KEY` (+ `OPENAI_MODEL=gpt-4o-mini`) — enriches top 15 with `why relevant`/`gaps`.

---

### ⏰ Scheduling

`.github/workflows/job-hunt.yml`:

```yaml
schedule:
  - cron: "30 3 * * *"      # daily hunt 09:00 IST
  - cron: "45 3 1,4,7,10,13,16,19,22,25,28,31 * *"  # full digest every 3 days
workflow_dispatch: # manual hunt/report/full
```

Change crons, push — no redeploy.

---

### 📂 Structure

```
src/
  config.ts          # Zod schema, passthrough dynamic
  types.ts           # NormalizedJob/ScoredJob/JobSource
  sources/           # greenhouse/lever/ashby/smartrecruiters/linkedin/jobspy/watchlist/search.ts
  pipeline/          # normalize/filter/dedupe/score/ai/health.ts
  storage/seen-jobs.ts
  notifications/     # telegram (full md + instant) / email
  index.ts           # hunt → report orchestration
data/
  config.json        # all boards + prefs (dynamic)
  watchlist.json     # ⭐ priority companies
  seen-jobs.json     # auto-committed
  ats-health.json    # auto-committed
```

---

### 🚀 Use as template

1. **Use this template** → create your repo
2. Edit `data/config.json` + `data/watchlist.json` for your stack/location
3. Add `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` to repo Secrets
4. `Actions → Run workflow` → done. Runs forever.

---

<div align="center">

**Built for Pune, ready for worldwide remote** 🌍

*If it saves you one hour of job hunting a week, it’s working.*

⭐ Star if it helps — PRs for new board adapters welcome!

</div>
