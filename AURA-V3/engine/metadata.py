"""
Metadata Engine — Gemini-powered quality gate + YouTube metadata generation.

Pipeline (called after video is rendered):
  1. quality_check()  — Gemini reads the script and flags issues (too short, offensive,
                        factual errors, etc.)  Returns (pass: bool, notes: str)
  2. generate()       — Gemini produces YouTube-ready title, description, tags,
                        and a thumbnail image prompt.
  3. thumbnail()      — generates a 1280x720 thumbnail image via Pollinations
                        (falls back gracefully if balance depleted)

All Gemini calls use the REST API directly (no pip package needed).
"""

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import os
from config import GEMINI_API_KEY, POLLINATIONS_BYOP_KEY, TMP_RENDER_DIR

GROQ_API_KEY      = os.getenv("GROQ_API_KEY", "")
CEREBRAS_API_KEY  = os.getenv("CEREBRAS_API_KEY", "")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

logger = logging.getLogger("aura.metadata")

GEMINI_PRIMARY  = "gemini-3.5-flash"   # tier 1 — updated June 2026
GEMINI_TIMEOUT  = 90

# ── Robust JSON Extractor (Mirrors V2 script-writer.js exactly) ──────────────

def extract_json(raw_text: str) -> dict:
    """
    Robust JSON parser. LLMs frequently mess up JSON (trailing commas, literal newlines).
    This walks char-by-char to build a sanitized string before parsing, avoiding crashes.
    """
    import re
    # 1. Strip markdown fences
    text = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.IGNORECASE | re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.IGNORECASE | re.MULTILINE).strip()
    
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in response")
    json_str = text[start:end+1]

    # 2. State-machine string cleaner
    sanitized = []
    in_string = False
    i = 0
    while i < len(json_str):
        ch = json_str[i]
        if in_string:
            if ch == '\\':
                sanitized.append(ch)
                if i + 1 < len(json_str):
                    sanitized.append(json_str[i+1])
                    i += 1
            elif ch == '"':
                in_string = False
                sanitized.append(ch)
            elif ch == '\n':
                sanitized.append('\\n')
            elif ch == '\r':
                sanitized.append('\\r')
            elif ch == '\t':
                sanitized.append('\\t')
            else:
                sanitized.append(ch)
        else:
            if ch == '"':
                in_string = True
            sanitized.append(ch)
        i += 1

    sanitized_str = "".join(sanitized)
    
    # 3. Remove trailing commas before } or ]
    sanitized_str = re.sub(r",\s*([\]}])", r"\1", sanitized_str)
    
    try:
        return json.loads(sanitized_str)
    except Exception as e:
        logger.error(f"[BRAIN] JSON Extraction Failed: {e}")
        logger.error(f"[BRAIN] Raw Snippet (first 300): {raw_text[:300]}")
        raise ValueError(f"Extracted JSON invalid: {e}")


# ── LLM Cascade — 9-tier All-Gemini (verified live ai.google.dev, June 2026) ─
# Tier 1: gemini-3.5-flash        5 RPM / 250K TPM / 20 RPD
# Tier 2: gemini-3.1-flash-lite   15 RPM / 250K TPM / 500 RPD  ← high daily quota
# Tier 3: gemini-3-flash-preview   5 RPM / 250K TPM / 20 RPD
# Tier 4: gemma-4-31b-it          15 RPM / unlimited TPM / 1500 RPD ← unlimited tokens!
# Tier 5: gemma-4-26b-a4b-it      15 RPM / unlimited TPM / 1500 RPD
# Tier 6: gemini-2.5-flash-lite   10 RPM / 250K TPM / 20 RPD
# Tier 7: gemini-2.5-flash         5 RPM / 250K TPM / 20 RPD
# Tier 8: gemini-3.1-flash-live-preview  unlimited RPM / 65K TPM / unlimited RPD
# Tier 9: gemini-2.5-flash-native-audio-preview-12-2025  unlimited RPM / 1M TPM / unlimited RPD

_GEMINI_TIERS = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-3.1-flash-live-preview",
    "gemini-2.5-flash-native-audio-preview-12-2025",
]

# ── Polly Text Overflow Tiers (gen.pollinations.ai — OpenAI-compatible)
# Kicks in ONLY when all 9 Gemini tiers are exhausted.
# IDs verified live against gen.pollinations.ai/v1/models — June 2026
# Ordered by capacity_score descending (highest throughput first)
_POLLY_TEXT_TIERS = [
    "qwen-safety",       # Qwen3Guard 8B  — 250K capacity, near-free
    "nova-fast",         # Nova Micro      — 6900 capacity
    "mistral-small-3.2", # Mistral Small 3.2 — 4500
    "llama-scout",       # Meta Llama 4 Scout — 3400
    "mistral",           # Mistral Small 4 — 2800
    "qwen-coder",        # Qwen3 Coder 30B — 2200
    "gemma",             # Gemma 4 26B A4B — 2100
    "openai-fast",       # GPT-5.4 Nano — 1800
    "qwen-vision",       # Qwen3 VL 30B — 1600
    "openai",            # GPT-5 Nano — 1300
    "llama",             # Llama 3.3 70B — 1300
    "minimax-m2.7",      # MiniMax M2.7 — 1200
    "deepseek",          # DeepSeek V4 Flash — 1100
    "step-3.5-flash",    # StepFun 3.5 Flash — 1100
]


def _call_gemini(prompt: str, model: str) -> str:
    """Call Gemini API (generateContent REST). Single model, raises on failure."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set")
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={GEMINI_API_KEY}"
    )
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        },
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=GEMINI_TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    if "error" in data:
        err = data["error"]
        raise RuntimeError(f"Gemini {model} error {err.get('code')}: {err.get('message')}")
    candidates = data.get("candidates", [])
    if not candidates or not candidates[0].get("content"):
        finish = candidates[0].get("finishReason", "UNKNOWN") if candidates else "NO_CANDIDATES"
        raise RuntimeError(f"Gemini {model} empty response (finishReason={finish})")
    content = candidates[0]["content"]["parts"][0].get("text", "")
    if not content.strip():
        raise RuntimeError(f"Gemini {model} returned blank text")
    return content.strip()


def _call_polly_text(prompt: str, model: str) -> str:
    """Call Pollinations text API (OpenAI-compatible). Raises on failure."""
    if not POLLINATIONS_BYOP_KEY:
        raise RuntimeError("POLLINATIONS_BYOP_KEY not set")
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a helpful AI assistant. Respond only with valid JSON."},
            {"role": "user",   "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 2048,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://gen.pollinations.ai/v1/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {POLLINATIONS_BYOP_KEY}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=GEMINI_TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    if "error" in data:
        raise RuntimeError(f"Polly {model} error: {data['error']}")
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not content.strip():
        raise RuntimeError(f"Polly {model} returned empty content")
    return content.strip()


def _call_groq(prompt: str) -> str:
    """Groq fallback (llama-3.3-70b-versatile). Raises on failure."""
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY not set")
    body = json.dumps({
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": "Respond only with valid JSON."},
            {"role": "user",   "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.7,
        "max_tokens": 2048,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {GROQ_API_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=GEMINI_TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    if "error" in data:
        raise RuntimeError(f"Groq error: {data['error']}")
    return data["choices"][0]["message"]["content"].strip()


def _call_cerebras(prompt: str) -> str:
    """Cerebras fallback (llama3.1-70b). Raises on failure."""
    if not CEREBRAS_API_KEY:
        raise RuntimeError("CEREBRAS_API_KEY not set")
    body = json.dumps({
        "model": "llama3.1-70b",
        "messages": [
            {"role": "system", "content": "Respond only with valid JSON."},
            {"role": "user",   "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 2048,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.cerebras.ai/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {CEREBRAS_API_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=GEMINI_TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    if "error" in data:
        raise RuntimeError(f"Cerebras error: {data['error']}")
    return data["choices"][0]["message"]["content"].strip()


def _llm(prompt: str) -> str:
    """
    Full LLM cascade — Gemini primary (9 tiers) + Polly overflow (14 tiers) + Groq/Cerebras final.

    Tier group 1 (tiers 1-9):  All-Gemini via native API (GEMINI_API_KEY)
    Tier group 2 (tiers 10-23): Pollinations text models via gen.pollinations.ai (BYOP key)
    Tier group 3 (tiers 24-25): Groq + Cerebras direct APIs (GROQ_API_KEY / CEREBRAS_API_KEY)
    """
    json_directive = (
        "\n\nCRITICAL: YOU MUST RETURN ONLY VALID JSON. "
        "NO PRE-AMBLE, NO POST-AMBLE. DO NOT INCLUDE ANY MARKDOWN CODE BLOCKS. "
        "ENSURE ALL QUOTES ARE ESCAPED AND NO LITERAL NEWLINES ARE WITHIN STRINGS."
    )
    full_prompt = prompt + json_directive

    # Group 1: Gemini API (9 tiers)
    for model in _GEMINI_TIERS:
        try:
            result = _call_gemini(full_prompt, model)
            logger.info(f"[METADATA] LLM OK via Gemini/{model}")
            return result
        except Exception as e:
            logger.warning(f"[METADATA] Gemini/{model} failed: {e} — next...")

    logger.warning("[METADATA] All 9 Gemini tiers exhausted — cascading to Polly overflow...")

    # Group 2: Polly text models (14 high-capacity tiers)
    if POLLINATIONS_BYOP_KEY:
        for model in _POLLY_TEXT_TIERS:
            try:
                result = _call_polly_text(full_prompt, model)
                logger.info(f"[METADATA] LLM OK via Polly/{model}")
                return result
            except Exception as e:
                logger.warning(f"[METADATA] Polly/{model} failed: {e} — next...")
        logger.warning("[METADATA] All Polly text tiers exhausted — cascading to Groq/Cerebras...")

    # Group 3: Groq
    try:
        result = _call_groq(full_prompt)
        logger.info("[METADATA] LLM OK via Groq/llama-3.3-70b")
        return result
    except Exception as e:
        logger.warning(f"[METADATA] Groq failed: {e}")

    # Group 4: Cerebras
    try:
        result = _call_cerebras(full_prompt)
        logger.info("[METADATA] LLM OK via Cerebras/llama3.1-70b")
        return result
    except Exception as e:
        logger.warning(f"[METADATA] Cerebras failed: {e}")

    raise RuntimeError("[METADATA] ALL LLM tiers exhausted (Gemini×9 + Polly×14 + Groq + Cerebras). System halting.")


# ── 1. Quality Check ────────────────────────────────────────────────────────

def quality_check(script: str, title: str) -> tuple[bool, str]:
    """
    Run LLM quality gate before spending audio credits.
    Returns (passed: bool, notes: str).
    """
    if not GEMINI_API_KEY:
        logger.warning("[METADATA] GEMINI_API_KEY not set -- skipping quality check.")
        return True, "skipped (no API key)"

    prompt = f"""You are a quality reviewer for short-form Reddit storytelling videos (2-3 minutes).

Title: {title}

Script:
\"\"\"
{script[:3000]}
\"\"\"

Review for these issues ONLY:
1. Is the script language clearly English? (if not, flag it)
2. Is it too brief? (If it's under 150 words, flag as too_short). NOTE: There is NO maximum word limit. Scripts of 400-800 words are PERFECT and expected.
3. Does it contain clearly offensive/NSFL content? (flag as offensive)
4. Is it obviously gibberish or an error message? (flag as invalid)

Respond in JSON only (no markdown, no extra text):
{{"pass": true/false, "issues": [], "notes": "brief reason if failed"}}

If no issues found: {{"pass": true, "issues": [], "notes": "ok"}}"""

    try:
        raw = _llm(prompt)
        parsed = extract_json(raw)
        passed = bool(parsed.get("pass", True))
        notes  = parsed.get("notes", "ok")
        if not passed:
            logger.warning(f"[METADATA] Quality check FAILED: {notes} | issues={parsed.get('issues')}")
        else:
            logger.info(f"[METADATA] Quality check passed: {notes}")
        return passed, notes
    except Exception as e:
        logger.warning(f"[METADATA] Quality check error ({e}) — defaulting to PASS.")
        return True, f"check error: {e}"


# ── 2. Metadata Generation ──────────────────────────────────────────────────

def generate(script: str, title: str) -> dict:
    """
    Ask Gemini to produce YouTube-ready metadata.
    Returns dict with keys: yt_title, description, tags (list), thumbnail_prompt.
    """
    if not GEMINI_API_KEY:
        logger.warning("[METADATA] GEMINI_API_KEY not set -- returning empty metadata.")
        return _empty_meta(title)

    prompt = f"""You are a YouTube Shorts metadata specialist with deep expertise in viral storytelling content.

Original title hint: {title}
Script (full):
\"\"\"
{script[:1500]}
\"\"\"

Generate metadata SPECIFICALLY optimized for YouTube Shorts (sub-60 second vertical videos).
Respond in JSON only (no markdown):
{{
  "yt_title": "The title must be 60-80 characters. It must be a punchy, curiosity-gap hook — not a boring description. Make it feel like breaking news or a juicy secret. Use CAPITAL WORDS for 1-2 key words. Add ONE emoji at the end. Do NOT put hashtags in the title. Example: 'She EXPOSED Her MIL at Dinner and Ruined Everything 😱'",
  "description": "200-350 words MAXIMUM. Start with the most shocking line from the story (no intro). Then 2-3 tight paragraphs summarizing the conflict and resolution. Add a line break, then: 'Drop a PART 2 comment below if you want to know what happened next!' Then add a blank line and list 5-8 SEO keywords relevant to the story (no hashtags in the keywords). End with 5-8 hashtags on the last line: always include #shorts #youtubeshorts #storytime #redditstories plus 1-2 specific to the story.",
  "tags": ["tag1", "tag2", "..."],
  "thumbnail_prompt": "Cinematic 1280x720 thumbnail. Show a single dramatic human expression (shock, betrayal, or rage). Photorealistic. Bold, high-contrast lighting. No text. The scene must instantly communicate the emotional stakes of the story. Make it feel like a movie still."
}}

Tags rules (CRITICAL for algorithm):
- ALWAYS include: shorts, youtubeshorts, storytime, redditstories, reddit, aita
- Add 6-9 story-specific tags (characters, situation, emotion — e.g. 'mother in law', 'family drama', 'revenge')
- Total: 12-15 tags. No '#' prefix. All lowercase except proper nouns."""

    try:
        raw  = _llm(prompt)
        meta = extract_json(raw)

        # Validate required keys
        result = {
            "yt_title":         meta.get("yt_title", title)[:100],
            "description":      meta.get("description", "")[:5000],
            "tags":             meta.get("tags", [])[:20],
            "thumbnail_prompt": meta.get("thumbnail_prompt", ""),
        }
        logger.info(f"[METADATA] Generated: \"{result['yt_title']}\" | {len(result['tags'])} tags")
        return result

    except Exception as e:
        logger.warning(f"[METADATA] Generation error ({e}) — returning fallback metadata.")
        return _empty_meta(title)


# ── 3. Thumbnail Generation ─────────────────────────────────────────────────

def thumbnail(prompt: str, video_id: str) -> Path | None:
    """
    Generate a 1280x720 thumbnail via Pollinations image API.
    Returns the saved Path or None if generation fails.
    """
    if not prompt:
        return None

    out_path   = TMP_RENDER_DIR / f"{video_id}_thumb.jpg"
    if out_path.exists():
        logger.info(f"[METADATA] Thumbnail cache hit: {out_path.name}")
        return out_path

    encoded = urllib.parse.quote(prompt)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # 7-Tier Image Cascade (Polly by @Itachi-1824 — IDs verified live June 2026)
    # Tier 1-4: BYOP (paid, higher quality). Tier 5-6: BYOP (lower cost). Tier 7: Free (flux, no auth).
    _IMAGE_TIERS = [
        # (polly_id, requires_byop, use_v1_endpoint)
        ("flux",       True,  False),  # T1: Flux Schnell — fastest, 550 capacity
        ("zimage",     True,  False),  # T2: Z-Image Turbo — 500 capacity, photorealistic
        ("gptimage",   True,  False),  # T3: GPT Image 1 Mini — 100 capacity
        ("klein",      True,  False),  # T4: FLUX.2 Klein 4B — 100 capacity
        ("nova-canvas",True,  False),  # T5: Amazon Nova Canvas — 25 capacity, enterprise-grade
        ("gpt-image-2",True,  False),  # T6: GPT Image 1.5 — 20 capacity, best quality
        ("flux",       False, False),  # T7: Flux free tier — no auth, unlimited fallback
    ]

    for tier_idx, (model, needs_byop, _) in enumerate(_IMAGE_TIERS, 1):
        h = dict(headers)  # fresh copy per tier
        if needs_byop:
            if not POLLINATIONS_BYOP_KEY:
                continue
            h["Authorization"] = f"Bearer {POLLINATIONS_BYOP_KEY}"
        else:
            h.pop("Authorization", None)  # free tier — no auth header

        try:
            url = (
                f"https://image.pollinations.ai/prompt/{encoded}"
                f"?width=1280&height=720&model={model}&nologo=true&enhance=true"
                + ("" if needs_byop else "")
            )
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=180) as r:
                img_bytes = r.read()
            if len(img_bytes) < 5_000:
                raise ValueError(f"Response too small ({len(img_bytes)} B) — likely error page")
            out_path.write_bytes(img_bytes)
            logger.info(
                f"[METADATA] Thumbnail OK (tier {tier_idx}/7 — {model}{'[BYOP]' if needs_byop else '[FREE]'}): "
                f"{out_path.name} ({len(img_bytes)//1024} KB)"
            )
            return out_path
        except Exception as e:
            logger.warning(f"[METADATA] Image tier {tier_idx}/7 ({model}) failed: {type(e).__name__}: {e}")

    logger.error("[METADATA] All 7 image tiers failed. Halting thumbnail generation.")
    raise RuntimeError("Thumbnail generation failed across all 7 Polly image tiers.")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _empty_meta(title: str) -> dict:
    return {
        "yt_title":         title[:100],
        "description":      "",
        "tags":             ["reddit", "storytime", "satisfying"],
        "thumbnail_prompt": "",
    }
