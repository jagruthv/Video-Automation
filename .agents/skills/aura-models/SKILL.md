---
name: aura-models
description: >
  Complete reference for all AI models used in AURA — LLM cascade tiers, TTS models,
  image generation, video, audio transcription, and embeddings via Pollinations (Polly by @Itachi-1824).
  Use when modifying model selection, debugging API failures, or checking which model handles what.
  Avoids reading config.py or metadata.py. Full Polly registry: d:\Automation\.agents\polly_models_registry.json
---

# AURA AI Models Reference

## Platform: Pollinations AI ("Polly by @Itachi-1824")
**API Base:** `https://gen.pollinations.ai`  
**Auth:** `Authorization: Bearer {POLLINATIONS_BYOP_KEY}` (from `AURA-V2/.env`)  
**Live model list:** `GET https://gen.pollinations.ai/v1/models`  
**Format:** OpenAI-compatible for text (`/v1/chat/completions`), image (`/v1/images/generations`), embeddings (`/v1/embeddings`)  
**Full registry:** [`polly_models_registry.json`](file:///d:/Automation/.agents/polly_models_registry.json) — verified June 2026

---

## LLM Cascade (Current — All Gemini, V3 native API)
Used by: `AURA-V3/engine/metadata.py::_llm()` and `AURA-V2/src/modules/script-writer.js::callUnifiedModel()`

| Tier | Gemini API Model ID | RPM | TPM | RPD |
|------|---------------------|-----|-----|-----|
| 1 | `gemini-3.5-flash` | 5 | 250K | 20 |
| 2 | `gemini-3.1-flash-lite` | 15 | 250K | 500 |
| 3 | `gemini-3-flash-preview` | 5 | 250K | 20 |
| 4 | `gemma-4-31b-it` | 15 | **unlimited** | 1500 |
| 5 | `gemma-4-26b-a4b-it` | 15 | **unlimited** | 1500 |
| 6 | `gemini-2.5-flash-lite` | 10 | 250K | 20 |
| 7 | `gemini-2.5-flash` | 5 | 250K | 20 |
| 8 | `gemini-3.1-flash-live-preview` | **unlimited** | 65K | **unlimited** |
| 9 | `gemini-2.5-flash-native-audio-preview-12-2025` | **unlimited** | 1M | **unlimited** |

**API endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}`

---

## Image Generation (Thumbnails) — Polly Tiers

**Endpoint:** `POST https://gen.pollinations.ai/v1/images/generations`  
**Body:** `{"model": "{polly_id}", "prompt": "...", "width": 1280, "height": 720}`

| Tier | Name | Polly ID | Capacity | Cost/img |
|------|------|----------|----------|---------|
| 1 | Flux Schnell | `flux` | 550 | $0.0018 |
| 2 | Z-Image Turbo | `zimage` | 500 | $0.002 |
| 3 | GPT Image 1 Mini | `gptimage` | 100 | token-priced |
| 4 | FLUX.2 Klein 4B | `klein` | 100 | $0.01 |
| 5 | FLUX.1 Kontext | `kontext` | 25 | $0.04 |
| 6 | Nova Canvas | `nova-canvas` | 25 | $0.04 |
| 7 | GPT Image 1.5 | `gpt-image-2` | 20 | token-priced |

Used by: `AURA-V3/engine/metadata.py::thumbnail()`

---

## TTS Engine (Primary — Gemini API)
- **Model:** `gemini-3.1-flash-tts-preview`
- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent`
- **Voices:** `Aoede` (female) | `Charon` (male)
- **WordBoundary events** → frame-perfect captions

### TTS Fallback — Polly Audio
| Polly ID | Name | Notes |
|----------|------|-------|
| `qwen-tts` | Qwen TTS | Primary Polly TTS fallback |
| `qwen-tts-instruct` | Qwen TTS Instruct | Instruction-following TTS |
| `elevenlabs` | ElevenLabs | Premium voice quality |
| `elevenflash` | ElevenLabs Flash | Low-latency |
| `eleven-multilingual-v2` | ElevenLabs Multilingual | Multi-language |

---

## Audio Transcription (Polly) — FUTURE USE
For caption generation from existing audio, subtitle extraction, quality check.

| Tier | Name | Polly ID | Capacity | Cost/sec |
|------|------|----------|----------|---------|
| 1 | AssemblyAI Universal-2 | `universal-2` | 1500 | $0.00004 |
| 2 | Whisper Large V3 | `whisper` | 500 | $0.00004 |
| 3 | AssemblyAI Universal-3 Pro | `universal-3-pro` | 100 | $0.00006 |
| 4 | ACE-Step 1.5 Turbo | `acestep` | 70 | $0.0005 (audio gen) |
| 5 | GPT Realtime 2 | `gpt-realtime-2` | 25 | token-priced |

**Endpoint:** `POST https://gen.pollinations.ai/audio/{text}` (or `/v1/realtime` for GPT Realtime)

---

## Polly Text Models — Available for LLM Cascade Expansion
**Endpoint:** `POST https://gen.pollinations.ai/v1/chat/completions`

| Tier | Name | Polly ID | Capacity |
|------|------|----------|---------|
| 1 | Qwen3Guard 8B | `qwen-safety` | 250000 (safety classifier) |
| 2 | Nova Micro | `nova-fast` | 6900 |
| 3 | Mistral Small 3.2 | `mistral-small-3.2` | 4500 |
| 4 | Meta Llama 4 Scout | `llama-scout` | 3400 |
| 5 | Mistral Small 4 | `mistral` | 2800 |
| 6 | Qwen3 Coder 30B | `qwen-coder` | 2200 |
| 7 | Gemma 4 26B A4B | `gemma` | 2100 |
| 8 | GPT-5.4 Nano | `openai-fast` | 1800 |
| 9 | Qwen3 VL 30B | `qwen-vision` | 1600 |
| 10 | GPT-5 Nano | `openai` | 1300 |
| 11 | Meta Llama 3.3 70B | `llama` | 1300 |
| 12 | MiniMax M2.7 | `minimax-m2.7` | 1200 |
| 13 | DeepSeek V4 Flash | `deepseek` | 1100 |
| 14 | StepFun Step 3.5 Flash | `step-3.5-flash` | 1100 |
| ... | (tiers 15-35) | See `polly_models_registry.json` | ... |

---

## Embedding Models (Polly) — FUTURE USE
**Endpoint:** `POST https://gen.pollinations.ai/v1/embeddings`

| Tier | Name | Polly ID | Capacity | Context |
|------|------|----------|---------|---------|
| 1 | Text Embedding 3 Small | `openai-3-small` | 200000 | 8192 |
| 2 | Cohere Embed v4 | `cohere-embed-v4` | 76900 | 128000 |
| 3 | Text Embedding 3 Large | `openai-3-large` | 3600 | 8192 |
| 4 | Qwen3 Embedding 8B | `qwen3-embedding-8b` | 250 | 32768 |

---

## Video Generation (Polly) — NEEDS LIVE TEST
**NOTE:** `ltx-2.3` user name maps to `ltx-2` in Pollinations API. **Not yet integrated.**

| Polly ID | Notes | Status |
|----------|-------|--------|
| `ltx-2` | LTX-2.x by Lightricks. Video+audio output. | ⚠️ Test required |
| `wan-pro-1080p` | WAN video, 1080p, audio output | Available |
| `seedance-2.0` | Seedance video + audio | Available |
| `nova-reel` | Amazon Nova Reel | Available |

---

## V2 LLM Call Path
```
callUnifiedModel(prompt) → throttleBrain() → _GEMINI_TIERS[0..8] → callGemini()
```

## V3 LLM Call Path
```
_llm(prompt) → _GEMINI_TIERS[0..8] → _call_gemini(prompt, model)
```
