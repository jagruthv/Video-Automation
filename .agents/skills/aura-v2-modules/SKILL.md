---
name: aura-v2-modules
description: >
  Reference for all AURA-V2 production modules: script-writer, visual-engine,
  audio-engine, assembly-engine, music-engine, publisher, db, wikimedia-fetcher.
  Use when modifying scripting logic, visual rendering, audio processing, YouTube
  publishing, or database schema. Replaces reading 8 large JS module files.
---

# AURA-V2 Module Reference

**Location:** `d:\Automation\AURA-V2\src\modules\`

---

## `script-writer.js` — The Triumvirate Pipeline
Three AI agents in sequence, all using the 9-tier Gemini cascade:

### Agent 1: The Architect (Scripting)
`architectScript(topic, manualScript, affiliateLink, contextPrompt, retryCount, warehouseConfig)`

- Generates 150-200 word viral script (drama/revenge style)
- Hook: 5-7 words, drops viewer into action immediately
- 3-Act structure: Hook → Context (10s) → Conflict (30s) → Resolution (10s)
- Returns: `{script, title, imagePrompt, voiceGender}`

### Agent 2: The Visionary (Visuals)
`visionaryVisuals(script, template)`

- Generates per-scene Pexels image search queries
- Returns: `[{query, duration, effect}]`

### Agent 3: The Marketer (Metadata)
`marketerMetadata(script, visuals, affiliateLink)`

- Generates: `{yt_title, description, tags, thumbnail_prompt}`
- 60-80 char title, emoji, curiosity gap hook
- 200-350 word description, 12-15 tags

### LLM Call Stack
```
callUnifiedModel(prompt, systemRole, agentLabel)
  → throttleBrain() (15s global gap between consecutive Gemini calls)
  → GEMINI_TIERS[0..8] loop
  → callGemini(model, hardenedSystemRole + prompt)
  → extractJSON(raw) → parsed object
```

### JSON Extraction (`extractJSON`)
State-machine parser: handles literal newlines, trailing commas, escaped quotes.
Falls back gracefully with clear error logging.

---

## `visual-engine.js` — Visual Asset Renderer
`render(visuals, template) → imagePaths[]`

- Downloads images from Pexels API per scene query
- Applies template-specific styling (drama, legal, finance)
- Falls back to Wikimedia fetcher if Pexels fails
- Returns array of local image paths for assembly

---

## `audio-engine.js` — V2 TTS Layer
`generate(script, voice) → audioPath`

- Calls Gemini TTS first (same model as V3: `gemini-3.1-flash-tts-preview`)
- Falls back to Fish Speech TTS (local server at `FISH_SPEECH_URL`)
- Falls back to Pollinations qwen-tts (BYOP)
- Returns path to final MP3

---

## `assembly-engine.js` — FFmpeg Video Assembly
`compose(imagePaths, audioPath, metadata) → outputPath`

- Creates slideshow from images with `ffmpeg -loop 1 -t {duration}`
- Applies Ken Burns / zoom effects per scene
- Mixes audio with FFmpeg `-af` filters
- Adds caption overlay (drawtext filter)
- Output: 1080×1920 MP4 at 30fps

---

## `music-engine.js` + `music-downloader.js` — Background Music
`select(bgMode) → musicPath`

- `bgMode: "kinetic"` → kinetic sand loop (`n8n/kinetic_sand_vault_1.mp4`, audio stripped)
- `bgMode: "asmr"` → ASMR vault clip audio
- Downloads free-use music tracks via `music-downloader.js` when needed
- Music mixed at `-20dB` under narration

---

## `publisher.js` + `publish-queue.js` — YouTube Upload
`upload(videoPath, metadata) → ytVideoId`

- Uses YouTube Data API v3 (`googleapis` npm)
- Auth: `YT_CLIENT_ID` + `YT_REFRESH_TOKEN` (OAuth2)
- Sets: title, description, tags, category=22 (People & Blogs), privacy=public
- `publish-queue.js` manages rate limiting: max 5 uploads/day default

---

## `db.js` — SQLite Database (V2)
**Database:** `d:\Automation\AURA-V2\src\database.sqlite`

### Key Tables
| Table | Purpose |
|-------|---------|
| `videos` | Published video records |
| `warehouse_blueprints` | In-progress drafts (all stage data) |
| `library` | Completed, unpublished videos |
| `analytics` | Per-video performance metrics |

### Key Functions
- `addVideo(data)` — insert new video record
- `getWarehouseResidues(bgMode)` — fetch incomplete drafts by bgMode
- `updateWarehouseBlueprintStage(id, stage, status, message, assetPatch)`
- `markPublished(videoId, ytVideoId)`
- `getLibraryItems(limit, offset)` → paginated library

---

## `wikimedia-fetcher.js` — Free Image Fallback
`fetch(query) → imageUrl`

- Queries Wikimedia Commons API for CC-licensed images
- Used as fallback when Pexels API quota exhausted
- Returns direct image URL for download

---

## `templates.js` — Template Definitions
```js
templates = {
  drama:   { style: 'cinematic', palette: 'dark', captions: 'active-word' },
  legal:   { style: 'document', palette: 'light', captions: 'standard' },
  finance: { style: 'data-viz', palette: 'blue', captions: 'standard' },
}
```
