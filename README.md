# AURA — Autonomous Unified Reels Automator

> A fully autonomous AI video content factory that discovers trending topics, writes scripts, generates voice + visuals, assembles videos, and publishes to YouTube Shorts & Instagram Reels — all on a $0 budget using free-tier APIs.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    GitHub Actions (6x/day cron)               │
│                         src/index.js                          │
└──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────────────┘
       │      │      │      │      │      │      │
       ▼      ▼      ▼      ▼      ▼      ▼      ▼
   ┌──────┐┌─────┐┌─────┐┌──────┐┌─────┐┌──────┐┌──────────┐
   │Topic ││LLM  ││Voice││Visual││Assem-││Anti- ││Publisher │
   │Intel ││Casca││Engi-││Engi- ││bly   ││Flag  ││(YT/IG/X) │
   │      ││de   ││ne   ││ne    ││Engi- ││Engi- ││          │
   │8 src ││6 LLM││3 TTS││3 vis ││ne    ││ne    ││+ Affili- │
   │feeds ││prov.││tiers││tiers ││FFmpeg││Score ││ate Inject│
   └──┬───┘└──┬──┘└──┬──┘└──┬───┘└──┬───┘└──┬───┘└────┬─────┘
      │       │      │      │       │       │         │
      └───────┴──────┴──────┴───────┴───────┴─────────┘
                           │
                    ┌──────▼──────┐
                    │  MongoDB    │
                    │  Atlas (M0) │
                    └─────────────┘
```

## Module Map (22 modules)

| # | Module | File | Purpose |
|---|--------|------|---------|
| 1 | **Logger** | `src/utils/logger.js` | Winston with module-scoped child loggers |
| 2 | **Retry** | `src/utils/retry.js` | Exponential backoff with jitter |
| 3 | **TmpManager** | `src/utils/tmp-manager.js` | `/tmp/build` lifecycle (clips, audio, output) |
| 4 | **SSML Builder** | `src/utils/ssml-builder.js` | Edge-tts SSML prosody + voice rotation |
| 5 | **DB Connection** | `src/db/connection.js` | MongoDB Atlas pooled connection |
| 6 | **Schemas** | `src/db/schema.js` | 8 Mongoose models with TTL indexes |
| 7 | **Topic Intelligence** | `src/modules/topic-intelligence.js` | 8-source trending discovery + virality scoring |
| 8 | **LLM Cascade** | `src/modules/llm-cascade.js` | 6-provider cascade with health tracking |
| 9 | **Voice Engine** | `src/modules/voice-engine.js` | 3-tier TTS: edge-tts → gTTS → OpenAI |
| 10 | **Visual Engine** | `src/modules/visual-engine.js` | 3-tier visuals: Pexels → Pixabay → Pollinations |
| 11 | **Assembly Engine** | `src/modules/assembly-engine.js` | FFmpeg: normalize → background → subtitles → merge |
| 12 | **Anti-Flag Engine** | `src/modules/anti-flag-engine.js` | 6-dimension uniqueness scoring (0-100) |
| 13 | **Dedup Guard** | `src/modules/deduplication-guard.js` | 3-layer: hash → Dice similarity → borderline check |
| 14 | **Affiliate Engine** | `src/modules/affiliate-engine.js` | Frequency-controlled injection + Bitly shortening |
| 15 | **Task Manager** | `src/modules/task-manager.js` | Manual tasks (dashboard) → auto-discovery fallback |
| 16 | **Analytics Collector** | `src/modules/analytics-collector.js` | YouTube/IG metrics batch pull + dashboard stats |
| 17 | **Publisher Index** | `src/modules/publisher/index.js` | Auto-discovery plugin loader |
| 18 | **Base Publisher** | `src/modules/publisher/base-publisher.js` | Interface contract for all platforms |
| 19 | **YouTube Publisher** | `src/modules/publisher/youtube.js` | YouTube Data API v3 (upload, comment, metrics) |
| 20 | **Instagram Publisher** | `src/modules/publisher/instagram.js` | Graph API v25.0 (Reels container → poll → publish) |
| 21 | **TikTok Publisher** | `src/modules/publisher/tiktok.js` | Stub — Content Posting API v2 |
| 22 | **X/Twitter Publisher** | `src/modules/publisher/x-twitter.js` | Stub — OAuth 1.0a + media upload |

## Data Models (MongoDB)

| Model | Purpose | TTL |
|-------|---------|-----|
| `VideoRecord` | Every generated video: topic, script, providers, metrics, status | — |
| `Task` | Manual video requests from dashboard | — |
| `Channel` | Platform accounts + credentials + personas | — |
| `AffiliateProgram` | Referral URLs, CTAs, injection frequency | — |
| `TopicSeen` | Deduplication index (hash + normalized topic) | 90 days |
| `SystemLog` | Pipeline event log | 30 days |
| `UploadSchedule` | Daily upload slot allocation per channel | 7 days |
| `LLMHealth` | Per-provider failure tracking + cooldown | — |

## Pipeline Flow (per channel, per run)

```
1. Check quota        → skip if exhausted
2. Check schedule     → skip if no slot ready
3. Get next job       → manual task OR auto-discover
4. Generate script    → 6-LLM cascade (Gemini → Groq → Cerebras → Mistral → GitHub → OpenRouter)
5. Generate voice     → 3-TTS cascade (edge-tts → gTTS → OpenAI)
6. Acquire visuals    → 3-tier (Pexels → Pixabay → Pollinations AI)
7. Assemble video     → FFmpeg: normalize → background → ambient noise → ASS subtitles
8. Uniqueness check   → 6-dimension scoring, threshold 75/100
9. Select affiliate   → frequency-controlled, vertical-matched
10. Publish           → YouTube/Instagram + quota tracking
11. Post comment      → affiliate CTA with 30-120s natural delay
12. Mark topic seen   → dedup index updated
```

## GitHub Actions Workflows

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `pipeline.yml` | 6x/day (cron) + manual | Main video generation pipeline |
| `metrics.yml` | 2x/day | Pull YouTube/IG analytics into MongoDB |
| `ci.yml` | Every push/PR | Module load test + secret leak scan |
| `cleanup.yml` | Weekly (Sunday) | Strip old scriptJson blobs (>60 days) |

## Project Structure

```
aura/
├── .github/workflows/
│   ├── pipeline.yml         # 6x/day video generation
│   ├── metrics.yml          # 2x/day analytics pull
│   ├── ci.yml               # PR checks & secret scan
│   └── cleanup.yml          # Weekly data cleanup
├── src/
│   ├── index.js             # Main orchestrator (entry point)
│   ├── db/
│   │   ├── connection.js    # MongoDB Atlas connection
│   │   └── schema.js        # 8 Mongoose schemas
│   ├── modules/
│   │   ├── topic-intelligence.js
│   │   ├── llm-cascade.js
│   │   ├── voice-engine.js
│   │   ├── visual-engine.js
│   │   ├── assembly-engine.js
│   │   ├── anti-flag-engine.js
│   │   ├── deduplication-guard.js
│   │   ├── affiliate-engine.js
│   │   ├── task-manager.js
│   │   ├── analytics-collector.js
│   │   └── publisher/
│   │       ├── index.js          # Auto-discovery loader
│   │       ├── base-publisher.js # Interface contract
│   │       ├── youtube.js        # YouTube Data API v3
│   │       ├── instagram.js      # Graph API v25.0
│   │       ├── tiktok.js         # Stub
│   │       └── x-twitter.js      # Stub
│   └── utils/
│       ├── logger.js         # Winston module logger
│       ├── retry.js          # Exponential backoff
│       ├── ssml-builder.js   # SSML prosody variation
│       └── tmp-manager.js    # Temp directory lifecycle
├── dashboard/
│   ├── api/server.js         # Express REST API (JWT auth)
│   └── src/index.html        # React SPA (CDN, Tailwind)
├── scripts/
│   ├── validate-env.js       # Pre-flight env check
│   ├── setup-youtube-oauth.js # OAuth2 refresh token helper
│   └── strip-old-scripts.js  # Cleanup old scriptJson blobs
├── migrations/
│   └── seed-channels.js      # Bootstrap channels + affiliates
├── assets/
│   └── ambient/              # 3 noise files for anti-fingerprint
│       ├── soft_ambient_01.mp3
│       ├── quiet_hiss_02.mp3
│       └── deep_rumble_03.mp3
├── .env.example              # Full env template (44 variables)
├── .gitignore
└── package.json
```

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USER/aura.git
cd aura
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Fill in at minimum:
#   MONGODB_URI          (free MongoDB Atlas M0)
#   GEMINI_API_KEY       (free at aistudio.google.com)
#   PEXELS_API_KEY       (free at pexels.com/api)
```

### 3. Validate Environment

```bash
node scripts/validate-env.js
```

### 4. Seed Database

```bash
node migrations/seed-channels.js --apply
```

### 5. Setup YouTube OAuth (per channel)

```bash
node scripts/setup-youtube-oauth.js
# Follow prompts → store refresh token as GitHub Secret
```

### 6. Run Pipeline Locally

```bash
node src/index.js
```

### 7. Run Dashboard

```bash
node dashboard/api/server.js
# Open http://localhost:3001
```

### 8. Deploy to GitHub Actions

```bash
# Push to GitHub — workflows auto-activate
git push origin main

# Add all secrets in GitHub → Settings → Secrets → Actions
# Required: MONGODB_URI, GEMINI_API_KEY, PEXELS_API_KEY
# Plus YouTube/IG credentials for each channel
```

## API Keys Required

| Service | Cost | Purpose | Get It |
|---------|------|---------|--------|
| MongoDB Atlas | Free (M0) | Database | [mongodb.com/atlas](https://www.mongodb.com/atlas) |
| Google AI Studio | Free | Gemini 2.5 Flash LLM | [aistudio.google.com](https://aistudio.google.com) |
| Groq | Free | Llama 3.3 70B LLM | [console.groq.com](https://console.groq.com) |
| Pexels | Free | Stock video clips | [pexels.com/api](https://www.pexels.com/api/) |
| Pixabay | Free | Stock video fallback | [pixabay.com/api](https://pixabay.com/api/docs/) |
| YouTube Data API | Free (10K units/day) | Upload + metrics | [console.cloud.google.com](https://console.cloud.google.com) |
| Instagram Graph API | Free | Reels upload | [developers.facebook.com](https://developers.facebook.com) |
| Bitly | Free (1K links/mo) | URL shortening | [bitly.com](https://bitly.com) |

**Optional paid**: OpenAI TTS (`OPENAI_API_KEY`) for ultra-realistic voices.

## Dashboard

The dashboard provides a full management UI at `http://localhost:3001`:

- **Overview** — daily stats, 30-day metrics, alerts
- **Video Log** — paginated list with status, metrics, provider breakdown
- **Task Queue** — create manual tasks, set priority, target specific channels
- **Channels** — view/test channel auth, see quota usage
- **Affiliates** — manage programs, see injection history
- **System Logs** — filterable event log with error tracking

**Auth**: JWT-based. Login with `DASHBOARD_ADMIN_USER` / `DASHBOARD_ADMIN_PASS`.

## Anti-Detection Measures

AURA implements multiple anti-fingerprinting strategies:

1. **Voice rotation** — 4 edge-tts voices, avoids repeating last 2
2. **SSML prosody variation** — random rate/pitch per segment
3. **Ambient noise mixing** — 3 noise profiles at 3% volume
4. **Visual source rotation** — Pexels/Pixabay/Pollinations mix
5. **LLM provider rotation** — different writing styles per cascade
6. **Upload timing** — randomized slots with 90-min gaps, peak clustering
7. **Hook style variation** — tracks question/stat/bold_claim/scenario patterns
8. **Tag uniqueness** — monitors overlap with recent videos
9. **Topic deduplication** — 3-layer (hash → Dice → borderline)
10. **Uniqueness threshold** — videos below 75/100 are held, not published

## Cost Analysis

| Resource | Free Tier | AURA Daily Usage | Monthly Headroom |
|----------|-----------|------------------|-----------------|
| MongoDB Atlas | 512 MB | ~2 MB/month | 25x headroom |
| Gemini API | 250 RPD | ~30 calls/day | 8x headroom |
| Groq API | 1,000 RPD | Fallback only | ~33x headroom |
| Pexels API | 200 req/hr | ~30 req/day | ~160x headroom |
| YouTube API | 10,000 units/day | ~8,200/day (5 uploads) | 1.2x headroom |
| GitHub Actions | 2,000 min/month | ~300 min/month | 6x headroom |
| Edge-TTS | Unlimited | ~30 calls/day | ∞ |
| Pollinations AI | Unlimited | Fallback only | ∞ |

**Total monthly cost: $0.00** (all free tiers)

## Development

```bash
# Run with auto-restart
npm run dev

# Run specific module standalone
node src/modules/analytics-collector.js

# Validate modules load
node -e "require('./src/modules/llm-cascade')"

# Dry-run seed
node migrations/seed-channels.js

# Dry-run cleanup
node scripts/strip-old-scripts.js
```

## License

MIT
