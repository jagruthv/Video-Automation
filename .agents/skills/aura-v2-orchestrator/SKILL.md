---
name: aura-v2-orchestrator
description: >
  Reference for AURA-V2's Node.js orchestrator layer — server.js, orchestrator.js,
  queue-manager.js, and config.js. Use when debugging pipeline triggers, adding new
  modes, modifying the production queue, or understanding the V2 build/forge flow.
  Replaces reading 4 large JS files.
---

# AURA-V2 Orchestrator Reference

**Location:** `d:\Automation\AURA-V2\src\`

---

## `server.js` — Express Entry Point
**Port:** `process.env.PORT` or `3001`

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/build` | Trigger pipeline run(s) |
| `POST` | `/api/build/script` | Build from manual script |
| `GET` | `/api/status` | Live status via SSE (`text/event-stream`) |
| `GET` | `/api/queue` | Queue state |
| Various | `/api/library/*` | Library CRUD |
| Various | `/api/warehouse/*` | Warehouse/draft management |
| Various | `/api/analytics/*` | Stats and metrics |
| `GET` | `/api/health` | Health check |

### Build Request Body
```json
{
  "mode": "normal|forge|ghost|script",
  "quota": 1,
  "template": "drama|legal|finance",
  "topic": "optional topic override",
  "affiliateLink": "",
  "bgMode": "kinetic|asmr",
  "contextPrompt": "optional context",
  "voice": "AUTO|nova|alloy|..."
}
```

---

## `orchestrator.js` — Pipeline Coordinator
**Function:** `start(config) → Promise<void>`

### Modes
- `normal` — full fresh pipeline (script → audio → visuals → assemble → publish)
- `forge` — resume from a warehouse blueprint (skip already-completed stages)
- `ghost` — batch mode, no publishing, saves to library
- `script` — manual script provided, skips scripting stage

### Pipeline Stages (Sequential)
```
Phase 1: SCRIPTING
  → scriptWriter.architectScript(topic, manualScript, ...)
  → scriptWriter.visionaryVisuals(script, template)
  → scriptWriter.marketerMetadata(script, visuals)
  → blueprintJson saved to warehouse

Phase 2: AUDIO
  → audioEngine.generate(script, voice) → audio MP3
  → warehouseLog('audio', 'done', audioPath)

Phase 3: VISUALS
  → visualEngine.render(visuals, template) → image array
  → warehouseLog('images', 'done', imagesJson)

Phase 4: MUSIC
  → musicEngine.select(bgMode) → music MP3
  → musicEngine.mix(audio, music) → mixed audio

Phase 5: ASSEMBLY
  → assemblyEngine.compose(images, mixedAudio, metadata)
  → output: {outputDir}/{videoId}.mp4

Phase 6: METADATA + PUBLISH
  → marketerMetadata (YouTube title/description/tags)
  → publisher.upload(videoPath, metadata) → YT video ID
  → db.markPublished(videoId)
```

### Warehouse Pattern
Each stage checkpoints progress into `warehouse_blueprints` table.
On failure at any stage: draft stays in warehouse for `forge` mode resumption.
On success: draft deleted, entry committed to library.

### Stage Cooldown
`INTER_STAGE_COOLDOWN`: `process.env.STAGE_COOLDOWN_MS` or `15000` ms between stages.

---

## `queue-manager.js` — Production Queue
**Class:** `QueueManager`

- Manages concurrent production slots (default: 1)
- `PRODUCTION_CONCURRENCY`: `process.env.PRODUCTION_CONCURRENCY` or `1`
- `enqueue(task)` — adds to queue
- `drain()` — processes all queued items
- `getState()` — returns `{active, queued, completed, failed}`

---

## `config.js` — Startup Validator
Validates required env vars on boot. Throws if `GEMINI_API_KEY` is missing.

### Required
- `GEMINI_API_KEY`

### Optional (logged at startup)
- `GROQ_API_KEY`, `CEREBRAS_API_KEY` (legacy, V2 now Gemini-only)
- `YT_CLIENT_ID`, `YT_REFRESH_TOKEN`
- `PEXELS_API_KEY`, `FISH_SPEECH_URL`
- `POLLINATIONS_BYOP_KEY`
- `AUTH_ENABLED` (default: `false`)

---

## Telemetry / Event Bus (`event-bus.js`)
- `EventEmitter` singleton
- Events: `log` (all console.log/error), `phase` (pipeline phase changes)
- Dashboard subscribes via SSE to relay real-time logs
- Console is monkey-patched at orchestrator top to emit all output

---

## Starting V2
```bash
cd d:\Automation\AURA-V2
node src/server.js
# or
npm start
```
