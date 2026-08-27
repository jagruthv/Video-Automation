# AURA-V2 Pipeline Prompt Structure

The AURA-V2 prompt architecture uses a multi-agent **Triumvirate Pipeline**. Instead of relying on one massive, easily confused prompt, the cognitive load is divided sequentially across three distinct AI personas inside `src/modules/script-writer.js`.

---

## 1. THE ARCHITECT (Viral Narratologist)
**Core Role:** Generates the raw script, pacing rhythm, and underlying story foundation.
**Base Prompt:** `Expert AI Assistant` (with strict programmatic JSON-only directives appended unconditionally).

**Key Constraints Enforced in the Prompt:**
*   **Lethal Hook (Scene 1):** Must be a shocking statement, uncomfortable question, or jaw-dropping reveal to stop doom-scrolling in under 3 seconds. *(e.g. "She remembered dying. She was 4 years old.")*
*   **Open Loop (Final Scene):** Must end with an unanswered emotional question, cliffhanger, or profound observation to drive comments and loop-rewatching.
*   **Pacing Rhythm:** Text must be split into hyper-short, punchy scenes exactly 12-16 words max. The last 4 scenes must escalate tension relentlessly.
*   **Drama Arc Specialization:** If the "Real Life Drama & Betrayal" pillar is picked, an aggressive karma arc is strictly enforced via prompt injection:
    *   Drop into the worst moment in scene 1 without backstory.
    *   Scenes 2-5: Establish the relationship.
    *   Scenes 6-10: Discovery and confrontation.
    *   Scenes 15-18: The betrayer's karma — slow, natural consequences (no revenge).
    *   Scenes 19+: The narrator's quiet comeback.
*   **Entity Extraction:** Demands tightly constrained JSON, actively separating the `real_world_subject` string (for factual Wikipedia image hunting) from the core `narration` text block.

---

## 2. THE VISIONARY (Cinematic Prompt Engineer)
**Core Role:** Reads the Architect's text line-by-line and reverse-engineers specialized Midjourney/Stable-Diffusion image prompts.
**Base System Prompt:** `You are THE VISIONARY, an Expert AI Cinematographer. You specialize in Midjourney/Stable Diffusion prompting for high-end cinematic visuals.`

**Key Constraints Enforced in the Prompt:**
*   **Visual Style Binding:** Ultra-high-action cinematic shot, 35mm anamorphic lens, hyper-realistic, vivid colors, deep shadows, 8k resolution.
*   **Negative Prompt Matrix:** Implicitly forces the AI to actively avoid blur, low-res, distortion, and glitchy limbs.
*   **Dual Prompting Vectors:** Calculates both an `image_prompt` (static freeze-frame layout, used for BYOP/Local Image Generators) and a `video_prompt` (a directional motion imperative like "Slow orbital pan right, particles floating", for Image2Video modules).

---

## 3. THE MARKETER (Growth & SEO Strategist)
**Core Role:** Evaluates the finished video layout and writes maximum-conversion social media metadata.
**Base System Prompt:** `You are THE MARKETER, an expert TikTok/Shorts growth strategist and SEO copywriter.`

**Key Constraints Enforced in the Prompt:**
*   **Algorithmic Descriptions:** Tailored specifically to hack TikTok/Shorts average view duration and user retention metrics.
*   **SEO Anchors:** Generates exactly 5 SEO-optimized tags/hashtags mathematically chosen to ensure algorithmic search indexing.

---

## Advanced Architecture Mechanism: The Self-Healing Loop
In addition to the static text, AURA programmatically alters the prompt at runtime. If Gemini, Llama, or Groq outputs malformed JSON string-data due to hallucination, the orchestrator refuses to crash. Instead, it catches the error and executes an **automatic retry loopback** where a brutal "strictness hook" is dynamically jammed into the top of the context window:

> `CRITICAL: YOUR PREVIOUS OUTPUT HAD INVALID JSON. RETURN PERFECT, RAW JSON ONLY. NO OTHER TEXT. DO NOT USE LITERAL NEWLINES INSIDE QUOTES.`

This ensures 99.9% uptime and zero unhandled rendering faults across large batch rendering runs.
