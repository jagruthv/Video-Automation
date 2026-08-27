---
name: aura-v3-forges
description: >
  Reference for all AURA-V3 forge modules in engine/forges/ — audio_forge, caption_forge,
  assembly, manim_forge, map_forge, ui_forge, vault_forge, logger_setup. Use when adding
  new visual engines, debugging rendering artifacts, or changing caption style. Replaces
  reading 7+ forge files.
---

# AURA-V3 Forge Modules Reference

**Location:** `d:\Automation\AURA-V3\engine\forges\`

The forge system processes each `TimelineBlock` from the Director Script independently,
then `assembly.py` concatenates all block clips into the final video.

---

## `audio_forge.py` — Audio Block Renderer
**Function:** `render_audio_block(block, video_id, audio_engine) → Path`

- Takes a single `TimelineBlock`
- Calls `audio_engine.generate(block.Audio_Narration, block_audio_id)`
- Returns path to the block's MP3 file
- Block audio ID format: `{video_id}_b{block.Block_ID}`

---

## `caption_forge.py` — Subtitle Burn-In
**Function:** `render_captions(video_path, audio_path, word_timings, output_path) → Path`

### Caption Logic
- Groups words into cards of `CAPTION_WORDS_PER_GROUP` (5 words default)
- Burns captions with `CAPTION_FONT_SIZE` (78px), `CAPTION_Y_POSITION` (1382px)
- Active word highlighted in **yellow**, others in **white**, all with black stroke
- Uses `word_timings` dict (start_ms → word) from Gemini TTS `WordBoundary` events
- FFmpeg `drawtext` filter with per-word timing — frame-perfect sync

### Styling Constants (from config.py)
```
Font size: 78px
Y position: 1382px (72% down the 1920px frame)
Border width: 5px black stroke
Active word: yellow (#FFFF00)
Inactive words: white (#FFFFFF)
```

---

## `assembly.py` — Block Assembler
**Function:** `assemble_blocks(blocks, audio_paths, video_paths, output_path) → Path`

- Takes rendered audio and video clips for each block
- Merges audio+video per block using FFmpeg `-i video -i audio -c:v copy -c:a aac`
- Concat demuxes all block clips in Block_ID order
- Output: single continuous MP4 (before caption burn-in)

---

## `manim_forge.py` — Manim Animation Renderer
**Function:** `render_manim_block(block, output_path) → Path`

### Supported Scenes
1. **`Manim_Legal_Doc`** → `LegalDocScene`:
   - Renders a legal document with animated text reveal
   - Highlights `highlight_text` phrases in yellow
   - Optional bold title at top
   - Duration matches block audio length

2. **`Manim_Flowchart`** → `FlowchartScene`:
   - Linear or custom-edge flowchart
   - Nodes animate in sequence
   - Optional title above chart

### Manim Settings
- Resolution: 1080×1920 (portrait)
- FPS: 30
- Background: `#0a0a0a` (near-black)
- Renders to `TMP_RENDER_DIR` then moved to block clip path

---

## `map_forge.py` — Mapbox Map Renderer
**Function:** `render_map_block(block, output_path) → Path`

### Flow
1. Extract `lat`, `lon`, `location_name` from `MapEngineParams`
2. Fetch **country tile**: `MAP_COUNTRY_ZOOM` (zoom 4) via Mapbox Static API
3. Fetch **city tile**: `MAP_CITY_ZOOM` (zoom 12) via Mapbox Static API
4. Animate: zoom from country → city using FFmpeg `zoompan` filter
5. Add location name text overlay (PIL)
6. Encode to 1080×1920 MP4 matching block audio duration

### Mapbox API Call
```
GET https://api.mapbox.com/styles/v1/mapbox/dark-v10/static/{lon},{lat},{zoom}/1080x1920?access_token={MAPBOX_TOKEN}
```
**Requires:** `MAPBOX_TOKEN` in `.env`

---

## `ui_forge.py` — iOS UI Popup Renderer
**Function:** `render_ui_block(block, output_path) → Path`

### Supported Popup Types
- **`sms`** — iOS SMS notification card (rounded rectangle, avatar, message bubble)
- **`email`** — Email notification card (app icon, sender, preview text)

### Rendering
- Pillow (PIL) draws the popup on `#1c1c1e` (iOS dark) background
- Font: SFProDisplay-Regular / Bold from `assets/fonts/`
- Popup animates in from top with fade effect
- Final still image looped for block audio duration as MP4

---

## `vault_forge.py` — Vault Clip Renderer
**Function:** `render_vault_block(block, duration_s, output_path) → Path`

- Calls `VaultManager.get_clips(n=1, duration_s)` to select a clip
- Applies motion effect (`effect` param from `BackgroundVaultParams`):
  - `none` — static clip, direct stream copy
  - `slow_zoom` — FFmpeg `zoompan` filter, gradual 1.02x zoom over duration
  - `ken_burns` — FFmpeg `zoompan` with random pan direction + zoom
- Scales/crops to 1080×1920
- Output: MP4 matching block audio duration

---

## `logger_setup.py` — Forge Logger
**Function:** `get_forge_logger(name) → logging.Logger`

- Returns a logger prefixed with `aura.forge.{name}`
- Uses the same rotating file handler as main pipeline
- All forges call this at module level: `logger = get_forge_logger("manim")`

---

## Forge Dispatch (in `main.py` / `api.py`)
```python
match block.Visual_Engine:
    case "Background_Vault"  → vault_forge.render_vault_block(block, duration_s, path)
    case "Map_Engine"        → map_forge.render_map_block(block, path)
    case "Manim_Legal_Doc"   → manim_forge.render_manim_block(block, path)
    case "Manim_Flowchart"   → manim_forge.render_manim_block(block, path)
    case "UI_Popup"          → ui_forge.render_ui_block(block, path)
```
