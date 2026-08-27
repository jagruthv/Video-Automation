---
name: aura-v3-engine
description: >
  Reference for all AURA-V3 Python engine modules: audio.py, vault.py, compositor.py,
  db.py, rewriter.py, script_guard.py, balance.py, metadata.py. Use when debugging
  pipeline failures, editing audio/video processing logic, or adding new engine features.
  Replaces reading 8+ Python engine files.
---

# AURA-V3 Engine Modules Reference

**Location:** `d:\Automation\AURA-V3\engine\`

---

## `audio.py` — AudioEngine (TTS)
**Class:** `AudioEngine`  
**Exceptions:** `AudioPartialError(chunk1_path, remaining)` — raised on BYOP exhaustion mid-generation

### Flow
```
generate(script, video_id, voice=None)
  → _preprocess_script()         # abbreviation expansion + breath pauses
  → gender detection (he/his → Charon, default → Aoede)
  → Gemini TTS attempt:
      POST /models/gemini-3.1-flash-tts-preview:generateContent
      → raw PCM bytes
      → FFmpeg: PCM → WAV → MP3
      → saved to TMP_AUDIO_DIR/{video_id}.mp3
  → On failure → Pollinations BYOP qwen-tts:
      Full script → BYOP request → MP3
      On 403 → _split_at_sentence() → chunk1 saved → AudioPartialError raised
  → resume(chunk1_path, remaining, video_id):
      chunk2 via BYOP → _concat_audio(chunk1, chunk2) → final MP3
```

### Script Preprocessor
- `_ABBREV_MAP` — 40+ acronym expansions (AWS→"Amazon Web Services", SQL→"Sequel", etc.)
- `_REVEAL_KEYWORDS` — sentence-level pause injection (converts `.` → `...` after reveal phrases)
- `_inject_breath_pauses(text)` — applies pauses to emotionally charged sentences

### Gemini TTS Body Format
```python
{
  "contents": [{"parts": [{"text": f"<speak>{director_notes}{text}</speak>"}]}],
  "generationConfig": {"responseModalities": ["AUDIO"],
                       "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}
}
```

---

## `vault.py` — VaultManager
**Class:** `VaultManager`  
**Exception:** `VaultEmptyError` — raised when vault has no usable clips

### Key Methods
- `get_clips(n, duration_s)` → `List[ClipInfo]` — returns n non-repeated clips totaling `duration_s`
- `_ClipHistory` — persists last 10 concat hashes to `data/clip_history.json` (prevents visual repetition)
- Large clips (>500MB, e.g., kinetic sand) are **random-seeked** rather than fully read

### Supported Extensions
`.mp4`, `.mov`, `.mkv`

### Clip Selection Logic
1. Scan `VAULT_ROOT` for all supported video files
2. Exclude recently used combos (clip_history.json)
3. For large clips: `ffprobe` to get duration → random seek point
4. For normal clips: direct path selection

---

## `compositor.py` — FFmpegCompositor
**Class:** `FFmpegCompositor`

### Key Methods
- `compose(blocks, audio_path, output_path)` — assembles all rendered block clips
- `remix(input_path, output_path)` — re-encodes with VIDEO_BITRATE/AUDIO_BITRATE
- Uses `concat demuxer` for stream-copy joining (no re-encode on concat)
- Final output: 1080×1920, 30fps, libx264, AAC 192k

---

## `db.py` — DatabaseTracker
**Class:** `DatabaseTracker(recover=False)`

### Schema (SQLite, `data/aura_v3.db`)
```sql
videos (
  id TEXT PRIMARY KEY,       -- SHA256 hash of script+title
  title TEXT,
  script TEXT,
  status TEXT,               -- pending|rendering|done|failed
  output_path TEXT,
  created_at REAL,
  completed_at REAL,
  error TEXT
)
```

### Key Methods
- `add(id, title, script)` → inserts pending row
- `set_status(id, status, output_path=None, error=None)`
- `get(id)` → dict or None
- `list_recent(n=20)` → list of dicts
- `recover=True` on init → resets all `rendering` → `failed` on startup (crash recovery)

---

## `rewriter.py` — Script Rewriter
**Function:** `rewrite_and_chunk(script, title, retry_count=0) → {"script": str}`

- Calls `_llm()` from metadata.py (same 9-tier Gemini cascade)
- Target: ~190 words, 55s at 1.4x TTS speed
- Self-heals: retries up to 2 times on JSON parse failure
- Falls back to returning original script on exhausted retries
- Prompt enforces 3-act structure: Hook (5-7 words) → Context → Conflict → Resolution

---

## `script_guard.py` — Script Validator
**Function:** `check_and_trim(script, title) → str`

- Checks minimum word count (150 words)
- Checks maximum word count (enforces TARGET_DURATION_MAX via WPM estimation)
- Strips forbidden content patterns
- Returns cleaned, length-appropriate script string

---

## `balance.py` — BYOP Balance Checker
**Function:** `byop_has_credits() → bool`

- Calls Pollinations balance API with BYOP key
- Returns True if pollen balance > 0
- Called before any Pollinations TTS attempt

---

## `metadata.py` — Metadata Engine
See `aura-models` skill for cascade details.

**Functions:**
- `quality_check(script, title) → (passed: bool, notes: str)` — LLM quality gate
- `generate(script, title) → dict` — produces yt_title, description, tags, thumbnail_prompt
- `thumbnail(prompt, video_id) → Path | None` — generates 1280×720 JPG via Pollinations

**Called after video is rendered, before YouTube upload.**
