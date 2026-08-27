"""
Script Guard — Duration Estimator & AI Trimmer
===============================================

Math at TTS_SPEED = 1.4x (FFmpeg atempo):
  output_duration = (words / WORDS_PER_MINUTE * 60) / TTS_SPEED

Target: 0:45 – 0:55 output  →  script must be ~158 – 193 words

Trim strategy:
  Pass 1 (gentle) — target ~180 words: keep every beat, remove filler only
  Pass 2 (strict)  — target ~158 words: surgical — only named events survive
  
LLM preference: Groq (fast, free tier) → Pollinations text (fallback, no key needed)
"""

import json
import logging
import urllib.request
import urllib.error
from pathlib import Path
from config import (
    GROQ_API_KEY, POLLINATIONS_BYOP_KEY,
    TTS_SPEED, WORDS_PER_MINUTE,
    TARGET_DURATION_MIN, TARGET_DURATION_MAX,
)

logger = logging.getLogger("aura.script_guard")

# ── Word targets calculated from duration + speed ──────────────────────────
# output_duration = words / WPM * 60 / SPEED
# → words = output_duration * SPEED * WPM / 60
_wps = TTS_SPEED * WORDS_PER_MINUTE / 60          # words per output-second

import re

MAX_WORDS   = int(TARGET_DURATION_MAX * _wps)          # ~193 words -> 0:55 output (hard ceiling)
SOFT_TARGET = int((TARGET_DURATION_MAX - 10) * _wps)   # ~180 words -> 0:45 output (Pass 1 target)
HARD_TARGET = int(TARGET_DURATION_MIN * _wps)           # ~158 words -> 0:45 output (Pass 2 floor)

# Regex: matches http(s) URLs and bare shortlinks (amzn.to, bit.ly, etc.)
_URL_RE  = re.compile(
    r'https?://\S+|'
    r'\b(?:amzn\.to|bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|t\.co|rb\.gy|shorturl\.at)/\S+',
    re.IGNORECASE,
)
# Bracket annotations: [affiliate link], [sponsored], [ad], [promo code], etc.
_BRACKET_RE = re.compile(r'\[.*?\]', re.IGNORECASE)
# Hashtags (e.g. #fyp #reddit) — ElevenLabs reads the # as "hashtag"
_HASHTAG_RE = re.compile(r'#\w+')


# ── Public API ──────────────────────────────────────────────────────────────

def check_and_trim(script_text: str, video_id: str, title: str) -> str:
    """
    Sanitize, estimate output duration. If > 3:00, run up to 2 AI trim passes.
    Returns the (possibly trimmed and sanitized) script ready for TTS.
    """
    # ── Step 0: Sanitize non-speech elements ────────────────────────────────
    clean = _sanitize_for_tts(script_text)
    if len(clean) != len(script_text):
        logger.info(
            f"[GUARD] Sanitized script: {len(script_text)} -> {len(clean)} chars "
            f"(removed URLs, hashtags, bracket annotations)"
        )

    words    = _count(clean)
    est_secs = _estimate(words)

    logger.info(
        f"[GUARD] \"{title[:55]}\"  →  {words} words  "
        f"≈ {_fmt(est_secs)} at {TTS_SPEED}x  (target ≤ {_fmt(TARGET_DURATION_MAX)})"
    )

    if est_secs <= TARGET_DURATION_MAX:
        logger.info(f"[GUARD] Within limit ({words} words) -- no trim needed")
        return clean  # always return sanitized version


    overshoot = est_secs - TARGET_DURATION_MAX
    logger.warning(
        f"[GUARD] ⚠️  Over by {_fmt(overshoot)} — running Pass 1 (gentle trim)"
    )

    # ── Pass 1: Gentle ──────────────────────────────────────────────────────
    pass1 = _trim(script_text, words, SOFT_TARGET, pass_num=1)
    if pass1:
        p1_words = _count(pass1)
        p1_est   = _estimate(p1_words)
        logger.info(f"[GUARD] Pass 1 result: {p1_words} words ≈ {_fmt(p1_est)}")

        if p1_est <= TARGET_DURATION_MAX:
            logger.info(f"[GUARD] ✅ Pass 1 success")
            return pass1

        # ── Pass 2: Strict ──────────────────────────────────────────────────
        logger.warning(
            f"[GUARD] Still over by {_fmt(p1_est - TARGET_DURATION_MAX)} — "
            f"running Pass 2 (strict trim)"
        )
        pass2 = _trim(pass1, p1_words, HARD_TARGET, pass_num=2)
        if pass2:
            p2_words = _count(pass2)
            p2_est   = _estimate(p2_words)
            logger.info(f"[GUARD] Pass 2 result: {p2_words} words ≈ {_fmt(p2_est)}")

            if p2_est > TARGET_DURATION_MAX:
                logger.warning(
                    f"[GUARD] ❌ Still {_fmt(p2_est)} after 2 passes — "
                    f"proceeding with best-effort (AI may need stricter system)"
                )
            else:
                logger.info(f"[GUARD] ✅ Pass 2 success")
            return pass2

    logger.warning("[GUARD] AI unavailable or returned empty -- using sanitized script")
    return clean


# ── Sanitizer ─────────────────────────────────────────────────────────────────────

def _sanitize_for_tts(text: str) -> str:
    """
    Clean the script so ElevenLabs receives only natural speech text:
    - URLs / affiliate links  -> 'the link in the description'
    - Bracket annotations     -> removed  (e.g. [affiliate link], [ad])
    - Hashtags                -> removed  (e.g. #fyp #reddit)
    - Multiple blank lines    -> single newline
    """
    # 1. Replace any URL with a clean spoken substitute
    out = _URL_RE.sub("the link in the description", text)
    # 2. Strip bracket annotations entirely
    out = _BRACKET_RE.sub("", out)
    # 3. Strip hashtags (keep surrounding spaces clean)
    out = _HASHTAG_RE.sub("", out)
    # 4. Collapse multiple spaces / blank lines
    out = re.sub(r' {2,}', ' ', out)
    out = re.sub(r'\n{3,}', '\n\n', out)
    # 5. V2 Aesthetic Dialogue Pacing — force breaths after dialogue intros
    out = re.sub(r'(i said(?::| )|she said(?::| )|he said(?::| ))', r'\1...', out, flags=re.IGNORECASE)
    out = out.strip()
    if out and not out.endswith(('.', '!', '?', '...')):
        out += '.'
    return out

# ── Internal helpers ────────────────────────────────────────────────────────

def _count(text: str) -> int:
    return len(text.split())


def _estimate(words: int) -> float:
    """Estimated output duration in seconds after TTS_SPEED speedup."""
    return words / WORDS_PER_MINUTE * 60 / TTS_SPEED


def _fmt(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m}:{s:02d}"


def _trim(script: str, current_words: int, target_words: int, pass_num: int) -> str | None:
    prompt = _build_prompt(script, current_words, target_words, pass_num)
    result = _call_llm(prompt)
    if result and len(result.split()) > 50:   # sanity: don't accept near-empty responses
        return result.strip()
    return None


def _build_prompt(script: str, current_words: int, target_words: int, pass_num: int) -> str:
    est_current = _fmt(_estimate(current_words))
    est_target  = _fmt(_estimate(target_words))

    if pass_num == 1:
        return f"""You are a viral short-form video script editor.

TASK: Trim the script below from {current_words} words to EXACTLY {target_words} words or fewer.
At {TTS_SPEED}x playback speed this brings the video from {est_current} down to {est_target}.
Hard ceiling: strictly under 1:00 (60 seconds).

ABSOLUTE RULES — NEVER VIOLATE:
1. Keep the opening hook (first sentence) WORD FOR WORD — do not touch it.
2. Keep the ending CTA (last 2 sentences, the "comment below" part) WORD FOR WORD.
3. Keep every named character, every plot twist, every timeline event, every confrontation.
4. Only remove: filler transitions ("just then", "as he walked in"), vague emotional descriptions, repeated information.
5. Do NOT add any new content.
6. Do NOT change character names, story beats, or the emotional arc.
7. Output ONLY the trimmed script — no labels, no commentary, no formatting.

SCRIPT ({current_words} words, needs to reach {target_words}):
{script}"""

    else:  # pass 2 — strict surgical cut
        return f"""EMERGENCY TRIM — PASS 2.
The script is still {current_words} words and MUST reach {target_words} words.
At {TTS_SPEED}x speed it will still run over 1:00. This is the final attempt.

SURGICAL RULES:
• Opening hook: keep first sentence IDENTICAL — zero changes.
• Closing CTA: keep last 2 sentences IDENTICAL — zero changes.
• Every word that is NOT a: named person, direct action, story event, spoken dialogue — DELETE IT.
• Remove ALL transition phrases, ALL emotion descriptions longer than 1 word, ALL scene-setting text.
• Output ONLY the script. Nothing else.

SCRIPT ({current_words} words → must be ≤ {target_words}):
{script}"""


# ── LLM Callers ─────────────────────────────────────────────────────────────

def _call_llm(prompt: str) -> str | None:
    if GROQ_API_KEY:
        result = _call_groq(prompt)
        if result:
            return result
    return _call_pollinations(prompt)


def _call_groq(prompt: str) -> str | None:
    payload = json.dumps({
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.25,
        "max_tokens": 2048,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.warning(f"[GUARD] Groq failed: {e} — falling back to Pollinations")
        return None


def _call_pollinations(prompt: str) -> str | None:
    payload = json.dumps({
        "model":    "openai",
        "seed":     42,
        "private":  True,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")

    headers = {"Content-Type": "application/json"}
    if POLLINATIONS_BYOP_KEY:
        headers["Authorization"] = f"Bearer {POLLINATIONS_BYOP_KEY}"

    req = urllib.request.Request(
        "https://text.pollinations.ai/",
        data=payload,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode("utf-8").strip()
    except Exception as e:
        logger.warning(f"[GUARD] Pollinations text failed: {e}")
        return None
