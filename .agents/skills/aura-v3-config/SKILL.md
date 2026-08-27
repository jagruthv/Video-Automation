---
name: aura-v3-config
description: >
  Complete reference for AURA-V3 config.py — all constants, env vars, path layout,
  TTS settings, FFmpeg defaults, and caption styling. Use before editing any V3 module
  to understand the shared configuration without reading the file.
---

# AURA-V3 Configuration Reference

**File:** `d:\Automation\AURA-V3\config.py`
**Loads from:** `d:\Automation\AURA-V2\.env` (V3 has no separate .env)

## API Keys (env vars from V2/.env)
| Constant | Env Var | Used By |
|----------|---------|---------|
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | TTS + LLM cascade + metadata |
| `POLLINATIONS_BYOP_KEY` | `POLLINATIONS_BYOP_KEY` | TTS fallback + thumbnails |
| `GROQ_API_KEY` | `GROQ_API_KEY` | Legacy (cascade now Gemini-only) |
| `CEREBRAS_API_KEY` | `CEREBRAS_API_KEY` | Legacy (unused in V3 cascade) |
| `PEXELS_API_KEY` | `PEXELS_API_KEY` | Stock imagery (future use) |
| `MAPBOX_TOKEN` | `MAPBOX_TOKEN` | Map_Engine forge |
| `CARTESIA_API_KEY` | `CARTESIA_API_KEY` | Reserved |

## Paths
| Constant | Value |
|----------|-------|
| `BASE_DIR` | `d:\Automation\AURA-V3\` |
| `DB_PATH` | `BASE_DIR/data/aura_v3.db` |
| `TMP_AUDIO_DIR` | `BASE_DIR/tmp/audio/` |
| `TMP_RENDER_DIR` | `BASE_DIR/tmp/renders/` |
| `OUTPUT_DIR` | `BASE_DIR/output/` |
| `LOG_PATH` | `BASE_DIR/logs/pipeline.log` |
| `VAULT_ROOT` | `d:\Automation\n8n\asmr-qa-vault\public\accepted_vault\` |
| `VAULT_DIR` | Same as `VAULT_ROOT` |
| `KINETIC_SAND_PATH` | `d:\Automation\n8n\kinetic_sand_vault_1.mp4` (3.49 GB) |
| `LARGE_CLIP_THRESHOLD_MB` | `500` — above this, clips are random-seeked |
| `FFMPEG_PATH` | env `FFMPEG_PATH` or `ffmpeg` (system) |
| `UI_FONT_PATH` | `BASE_DIR/assets/fonts/SFProDisplay-Regular.ttf` |
| `UI_FONT_BOLD_PATH` | `BASE_DIR/assets/fonts/SFProDisplay-Bold.ttf` |

## TTS Settings
| Constant | Value | Notes |
|----------|-------|-------|
| `TTS_MODEL` | `gemini-tts` | Active engine selector |
| `TTS_GEMINI_VOICE_FEMALE` | `Aoede` | Warm, storytelling |
| `TTS_GEMINI_VOICE_MALE` | `Charon` | Deep, authoritative |
| `TTS_VOICE` | `nova` | Semantic default (mapped to Gemini voice) |
| `TTS_TIMEOUT_S` | `300` | Per-request timeout |
| `TTS_SPEED` | `1.0` | Gemini controls pacing via Director's Notes |
| `TTS_BACKOFF_SECS` | `3600` | Sleep time on HTTP 429 |

## Video / FFmpeg Settings
| Constant | Value |
|----------|-------|
| `OUTPUT_WIDTH` | `1080` |
| `OUTPUT_HEIGHT` | `1920` |
| `OUTPUT_FPS` | `30` |
| `AUDIO_BITRATE` | `192k` |
| `VIDEO_BITRATE` | `4000k` |
| `VIDEO_CODEC` | `libx264` |
| `AUDIO_CODEC` | `aac` |
| `CRF` | `20` |
| `PRESET` | `fast` |
| `VIDEO_SPEED` | `2.0` (background video speed multiplier) |

## Duration Targeting
| Constant | Value |
|----------|-------|
| `WORDS_PER_MINUTE` | `150` |
| `TARGET_DURATION_MIN` | `45` seconds |
| `TARGET_DURATION_MAX` | `55` seconds (hard ceiling, must stay under 1 min) |

## Caption Styling
| Constant | Value |
|----------|-------|
| `CAPTION_WORDS_PER_GROUP` | `5` words per caption card |
| `CAPTION_FONT_SIZE` | `78` px |
| `CAPTION_Y_POSITION` | `1382` px from top (72% of height) |
| `CAPTION_BORDER_W` | `5` px black stroke |

## Map Engine Defaults
| Constant | Value |
|----------|-------|
| `MAP_COUNTRY_ZOOM` | `4` |
| `MAP_CITY_ZOOM` | `12` |

## Logging
- `LOG_LEVEL`: `INFO` (DEBUG | INFO | WARNING | ERROR)
- Rotating log: 5MB max, 3 backups, UTF-8 encoding
