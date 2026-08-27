# AURA Workspace — Agent Rules

## ⛔ CRITICAL PROHIBITIONS
1. **NO CODE IN CHAT** — Never generate full code blocks in chat. Edit files directly, describe changes in text.
2. **NO WASTE** — Zero-cost rendering only. Do NOT use paid cloud render APIs.
3. **NO BROWSER TESTS** — Never open browser or test URLs without explicit user permission.
4. **NO POLLING LOOPS** — Use schedule tool for waits; never loop on status checks.

## 🧠 ALWAYS LOAD SKILLS FIRST
Before any task, load the relevant skill(s) to avoid reading full source files:

| Task Type | Load Skill |
|-----------|-----------|
| First task on AURA | `aura-overview` |
| Any model/API change | `aura-models` |
| V3 config/paths | `aura-v3-config` |
| V3 engine (audio/vault/db) | `aura-v3-engine` |
| V3 forge (captions/maps/manim) | `aura-v3-forges` |
| Director Script format | `aura-director-script` |
| V2 pipeline/server | `aura-v2-orchestrator` |
| V2 modules (TTS/assembly/publisher) | `aura-v2-modules` |

## ⚖️ DESIGN PHILOSOPHY
1. **Titanium Aesthetic** — Dark modes, high contrast, vibrant accents, 9:16 Shorts optimization
2. **Retention First** — 3-word subtitle blocks (5-word cards), active word highlighting, high-pacing audio
3. **Stability First** — Fixed layouts, sequential processing, exponential backoff for all APIs

## 🛠️ PIPELINE STANDARDS
1. **Sync** — 100% frame-perfect word-to-subtitle alignment using Gemini TTS WordBoundary events
2. **LLM Cascade** — Always 9-tier Gemini-only (see `aura-models` skill). Never hardcode a single model.
3. **SEO** — 500-char descriptions, 12-15 viral tags, curiosity-gap clickbait titles
4. **Safety** — Sequential processing queue, exponential backoff, stale lock detection

## 📁 KEY FILES (Quick Reference)
- V2 .env: `d:\Automation\AURA-V2\.env`
- V3 config: `d:\Automation\AURA-V3\config.py`
- V3 LLM cascade: `d:\Automation\AURA-V3\engine\metadata.py`
- V2 LLM cascade: `d:\Automation\AURA-V2\src\modules\script-writer.js`
- V3 API server: `d:\Automation\AURA-V3\api.py` (port 8001)
- V2 HTTP server: `d:\Automation\AURA-V2\src\server.js` (port 3001)
- V3 logs: `d:\Automation\AURA-V3\logs\pipeline.log`
- **Polly model registry: `d:\Automation\.agents\polly_models_registry.json`** (all IDs verified live)
