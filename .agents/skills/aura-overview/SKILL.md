---
name: aura-overview
description: >
  Full project map and pipeline overview for the AURA (Automated Unified Rendering
  Architecture) YouTube Shorts automation system. Use this skill first before any task
  on this codebase to instantly understand structure, conventions, and how V2 and V3
  interact — without reading source files.
---

# AURA Project Overview

## What AURA Does
Fully automated YouTube Shorts production pipeline. Ingests Reddit-style drama/revenge story
topics, writes scripts via LLM, generates TTS audio with Gemini, renders visual forges
(maps, animations, UI popups, vault clips), burns captions, assembles with FFmpeg, and
publishes to YouTube — all local, zero cloud rendering cost.

## Root Layout (`d:\Automation\`)
```
AURA-V2/          ← Node.js orchestrator (brain + queue + publisher)
AURA-V2-Cloud/    ← Cloud-sync mirror of V2 (identical code, separate deployments)
AURA-V3/          ← Python rendering engine (Director Script → MP4)
AURA-V3-Cloud/    ← Cloud-sync mirror of V3
SFX/              ← Sound effects library (WAV/MP3 assets)
Vaults/           ← Asset vault storage
Video-Automation/ ← Standalone video tools / older scripts
n8n/              ← FFmpeg binary, kinetic-sand vault (3.5GB), ASMR QA vault
api_server.py     ← Root-level HTTP bridge helper
sanitizer.py      ← Script sanitizer utility
.aura-v2-rules.md ← Global agent operating rules (READ THIS FIRST)
```

## Two-Layer Architecture
```
AURA-V2 (Node.js, port varies)
  └── Receives topic/script
  └── Calls LLM → produces Director Script JSON
  └── Calls AURA-V3 API (port 8001) with Director Script
  └── Polls status, collects output MP4
  └── Uploads to YouTube via YT API

AURA-V3 (Python, port 8001)
  └── Receives Director Script JSON via HTTP
  └── Validates with Pydantic v2 (models.py)
  └── Processes each Timeline Block:
       ├── Audio Forge → Gemini TTS → MP3
       ├── Visual Forge → Map/Manim/UI/Vault → MP4 clip
       └── Caption Forge → burnt-in subtitles
  └── FFmpeg assembles all blocks → final MP4
  └── Metadata engine → YT title/description/tags
```

## Key Design Rules
1. **Director Script** is the contract between V2 and V3. JSON only, no file passing.
2. **Zero paid rendering** — all FFmpeg local, Gemini API free tier only.
3. **9-tier Gemini cascade** — single API key, multiple model fallbacks (see aura-models skill).
4. **Frame-perfect captions** — WordBoundary events from Gemini TTS, no captioning service.
5. **No code in chat** — always edit files, summarise changes as text.

## Output Flow
```
topic → script (V2) → Director Script JSON → V3 pipeline → output/[VideoID].mp4
                                                          → thumbnail_[VideoID].jpg
                                                          → YouTube upload
```

## Shared `.env`
V3 reads V2's `.env` file: `d:\Automation\AURA-V2\.env`
V3 has no separate `.env` — always edit V2's `.env`.

## Important Paths
- V2 .env: `d:\Automation\AURA-V2\.env`
- V3 config: `d:\Automation\AURA-V3\config.py`
- V3 output MP4s: `d:\Automation\AURA-V3\output\`
- Vault clips: `d:\Automation\n8n\asmr-qa-vault\public\accepted_vault\`
- Kinetic sand loop: `d:\Automation\n8n\kinetic_sand_vault_1.mp4`
- FFmpeg binary: `d:\Automation\n8n\ffmpeg.exe`
- V3 logs: `d:\Automation\AURA-V3\logs\pipeline.log`
- V3 SQLite DB: `d:\Automation\AURA-V3\data\aura_v3.db`
