# AURA-V2 Framework & AI Ecosystem
*Internal Record of Architecture, Fallbacks, and API Mechanisms*

This document tracks **why** we use specific AI tools and **how** they are implemented to bypass rate limits, costs, and official restrictions.

---

## 1. Google Veo (`whisk-api`)
**Why we use it**: Google Labs FX contains the world's most hyper-realistic video generation model (Veo 3.1). However, it is fundamentally an experimental playground with zero official developer APIs. To avoid burning GPU costs, we harvest Veo's free generations.
**How we use it**:
- We use the community-maintained `whisk-api` (reverse-engineered by Rohit Aryal).
- Because Whisk's backend runs on obfuscated TRPC and WebSockets, standard REST `fetch()` calls will immediately return a `404 Not Found`. `whisk-api` wraps a headless simulation to correctly pass our `.env` cookie (`GOOGLE_WHISK_COOKIE`).
- **Limitation Bypass**: By default, `whisk-api` restricts animations to Landscape. We modified the source code (`dist/Media.js`) locally to strip this check so we can generate Portrait (`9:16`) Short-form clips directly.
- **Failover (HTTP 429)**: The Labs account has strict daily quotas. Once `whisk-api` hits exhaustion, it throws a `429`, and the Visual Engine gracefully catches it and routes to Pexels Video.

## 2. Pollinations AI
**Why we use it**: We need 18 unique, highly-detailed frames per documentary. Using Hugging Face credits or ChatGPT for static frames is an unacceptable waste of budget. Pollinations provides completely free Stable Diffusion XL generations.
**How we use it**:
- Because Pollinations is a free, shared-GPU community tool, it aggressively rate-limits IPs. 
- We built a **15-Minute Budget Marathon**: The Engine restricts itself to 1 image every 25 seconds (`delay: 25000`). It patiently sweeps through the script to collect as many free frames as possible.
- **Failover**: If Pollinations drops a frame (due to server load), it queues the missing scene for "Phase 2 Emergency Cleanup" via the Hugging Face Inference API.

## 3. Pexels Stock Video
**Why we use it**: Motion is the most expensive AI commodity. When Veo 3.1 is disabled and Modal GPUs are toggled off by the user, we need completely free motion to avoid static-only videos.
**How we use it**:
- We pass the complex visual prompt to Gemini (Flash-Lite/2.5) as the `Search Architect` to distill the 100-word prompt into a 3-word stock search.
- We hit the Pexels REST API (`api.pexels.com/videos/search`) with aggressive newline sanitization, capturing the most relevant Portrait video available as a B-Roll fallback.

## 4. Atomic Cache Shield
**Why we use it**: If a pipeline halts mid-generation, restarting it shouldn't burn credits or time regenerating the exact same completed scenes.
**How we use it**:
- All visuals are tracked in `tmp/visuals`. If an `mp4` or `jpg` exists for a specific index, the `visual-engine.js` immediately skips calling APIs and loads from disk.
- **The Purge**: When a *new* mission begins, the Orchestrator executes a hard cache wipe to guarantee clips never bleed from an old script to a new one.
