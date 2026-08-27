"""
AudioEngine — Multi-provider TTS with gender-aware voice selection.

Primary:  Gemini 3.1 Flash TTS (Google AI Studio key — no pollen cost)
          Uses Director's Notes + emotion tags for drama storytelling.
Fallback: Pollinations qwen-tts (BYOP pollen-based, checkpoint/resume).

Flow (Gemini):
  full script -> audio-profile prompt built -> gemini-3.1-flash-tts-preview
              -> PCM raw bytes -> FFmpeg WAV->MP3 -> return path

Flow (Pollinations fallback):
  Normal:     full script -> BYOP request -> MP3 saved -> return path
  BYOP 403:   split script at sentence boundary -> chunk 1 (BYOP)
              -> save chunk 1 -> raise AudioPartialError(chunk1_path, remaining_script)
  Resume:     receive chunk 1 path + remaining -> chunk 2 -> concat -> return
"""

import logging
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from config import (
    POLLINATIONS_BYOP_KEY, TTS_MODEL, TTS_VOICE,
    TTS_TIMEOUT_S, TMP_AUDIO_DIR, FFMPEG_PATH,
    TTS_GEMINI_VOICE_FEMALE, TTS_GEMINI_VOICE_MALE,
)

logger = logging.getLogger("aura.audio")

MIN_VALID_AUDIO_BYTES = 10_240  # 10 KB — anything smaller is an error page


# ── Abbreviation / Acronym Preprocessor ────────────────────────────────────
# ElevenLabs spells out consecutive capitals letter-by-letter ("A W S").
# We replace known acronyms with their spoken form BEFORE sending to TTS.
# Rules:
#   - Whole-word replacements only (regex word boundary) — no partial matches
#   - Applied in order: longest/most-specific first
#   - Hyphenated form (D-N-A) forces ElevenLabs to read each letter cleanly

_ABBREV_MAP = {
    # Tech
    "AWS":   "Amazon Web Services",
    "GCP":   "Google Cloud Platform",
    "SaaS":  "Software as a Service",
    "API":   "A-P-I",
    "URL":   "U-R-L",
    "SQL":   "Sequel",
    "SSH":   "S-S-H",
    "VPN":   "V-P-N",
    "CPU":   "C-P-U",
    "GPU":   "G-P-U",
    "SSD":   "S-S-D",
    "RAM":   "Ram",
    "IP":    "I-P",
    "IT":    "I-T",
    # Legal / Finance
    "HOA":   "Homeowners Association",
    "LLC":   "L-L-C",
    "IRS":   "I-R-S",
    "NDA":   "N-D-A",
    "HR":    "H-R",
    "CEO":   "C-E-O",
    "CFO":   "C-F-O",
    "CTO":   "C-T-O",
    "COO":   "C-O-O",
    # Medical / Biology
    "DNA":   "D-N-A",
    "MRI":   "M-R-I",
    "ICU":   "I-C-U",
    "ER":    "E-R",
    # Social / Misc
    "AITA":  "Am I the jerk",
    "TIFU":  "Today I messed up",
    "MIL":   "mother-in-law",
    "FIL":   "father-in-law",
    "SIL":   "sister-in-law",
    "BIL":   "brother-in-law",
    "DIL":   "daughter-in-law",
    "SO":    "significant other",
    "DM":    "direct message",
    "OP":    "original poster",
    "YT":    "YouTube",
    "TBH":   "to be honest",
    "TBF":   "to be fair",
    "TL;DR": "long story short",
    "TLDR":  "long story short",
    "POV":   "point of view",
    "BF":    "boyfriend",
    "GF":    "girlfriend",
    "EX":    "ex",
}

import re as _re

# Keywords that signal a "reveal" moment — insert a breath pause AFTER the sentence ending
_REVEAL_KEYWORDS = [
    "found out", "realized", "discovered", "saw the", "looked at",
    "that's when", "but then", "and then", "turned out", "told me",
    "the truth", "the results", "bombshell", "shocked", "devastated",
    "couldn't believe", "never forget", "changed everything",
    "said nothing", "went silent", "looked me in the eye",
]

def _inject_breath_pauses(text: str) -> str:
    """
    Add breath pauses at emotionally charged sentence boundaries.
    Strategy: after a sentence ending with ! or . that contains a reveal keyword,
    replace the period/exclamation with '...' which ElevenLabs naturally pauses on.
    Single trailing '.' → '...' gives ~0.4s natural pause without any SSML needed.
    """
    sentences = _re.split(r'(?<=[.!?])\s+', text)
    result = []
    for i, sentence in enumerate(sentences):
        s_lower = sentence.lower()
        has_reveal = any(kw in s_lower for kw in _REVEAL_KEYWORDS)

        if has_reveal and i < len(sentences) - 1:
            # Replace terminal punctuation with ellipsis for a breath pause
            sentence = _re.sub(r'([.!])$', r'...\1', sentence.rstrip())
        result.append(sentence)
    return ' '.join(result)


def _preprocess_script(text: str) -> str:
    """
    Full script preprocessor — runs before every TTS request.
    Step 1: Replace acronyms/abbreviations with TTS-friendly spoken forms.
    Step 2: Inject natural breath pauses at reveal sentence boundaries.
    """
    # Step 1: Abbreviations
    for abbr, spoken in _ABBREV_MAP.items():
        text = _re.sub(rf'\b{_re.escape(abbr)}\b', spoken, text)

    # Step 2: Breath pauses
    text = _inject_breath_pauses(text)

    return text


# ── Custom exception ────────────────────────────────────────────────────────

class AudioPartialError(Exception):
    """
    Raised when BYOP balance is exhausted mid-generation.
    chunk1_path  — the MP3 file already saved (first half of script).
    remaining    — the script text still to be generated (second half).
    """
    def __init__(self, chunk1_path: Path, remaining: str):
        self.chunk1_path = chunk1_path
        self.remaining   = remaining
        super().__init__(
            f"BYOP balance exhausted — chunk 1 saved at {chunk1_path.name}. "
            f"Awaiting pollen top-up to generate chunk 2."
        )


# ── Helpers ─────────────────────────────────────────────────────────────────

def _split_at_sentence(script: str) -> tuple[str, str]:
    """
    Split a script into two halves at the sentence boundary closest to the midpoint.
    Guarantees both halves are non-empty.
    """
    mid = len(script) // 2

    # Search forward from midpoint for sentence-ending punctuation + space
    for i in range(mid, min(mid + 800, len(script) - 1)):
        if script[i] in ".!?" and (i + 1 >= len(script) or script[i + 1] in " \n"):
            part1 = script[: i + 1].strip()
            part2 = script[i + 1 :].strip()
            if part1 and part2:
                return part1, part2

    # Search backward from midpoint
    for i in range(mid - 1, max(mid - 800, 0), -1):
        if script[i] in ".!?" and (i + 1 >= len(script) or script[i + 1] in " \n"):
            part1 = script[: i + 1].strip()
            part2 = script[i + 1 :].strip()
            if part1 and part2:
                return part1, part2

    # Hard fallback: split at word boundary near midpoint
    words = script.split()
    half  = len(words) // 2
    return " ".join(words[:half]), " ".join(words[half:])


def _call_cartesia(text: str, voice: str, timeout: int) -> bytes:
    """
    Cartesia TTS fallback (api.cartesia.ai /v1/tts).
    Uses CARTESIA_API_KEY from config. Returns MP3 bytes.
    Raises RuntimeError if key is missing or request fails.
    """
    import json, os, io
    cartesia_key = os.getenv("CARTESIA_API_KEY", "")
    if not cartesia_key:
        raise RuntimeError("[AUDIO] CARTESIA_API_KEY not set — Cartesia unavailable")

    # Map voice names to Cartesia voice IDs
    _CARTESIA_VOICES = {
        "nova":    "a0e99841-438c-4a64-b679-ae501e7d6091",  # warm female
        "shimmer": "a0e99841-438c-4a64-b679-ae501e7d6091",
        "onyx":    "79a125e8-cd45-4c13-8a67-188112f4dd22",  # deep male
        "echo":    "79a125e8-cd45-4c13-8a67-188112f4dd22",
        "alloy":   "2ee87190-8f84-4925-97da-e52547f9462c",  # neutral
    }
    voice_id = _CARTESIA_VOICES.get(voice, _CARTESIA_VOICES["nova"])

    body = json.dumps({
        "model_id": "sonic-2024-10-19",
        "transcript": text,
        "voice": {"mode": "id", "id": voice_id},
        "output_format": {"container": "mp3", "encoding": "mp3", "sample_rate": 44100},
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.cartesia.ai/tts/bytes",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Cartesia-Version": "2024-06-10",
            "X-API-Key": cartesia_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()

    if len(data) < MIN_VALID_AUDIO_BYTES:
        raise RuntimeError(f"[AUDIO] Cartesia returned too-small response ({len(data)} B)")
    logger.info(f"[AUDIO] Cartesia TTS OK: {len(data) // 1024} KB")
    return data


def _concat_audio(chunk1: Path, chunk2: Path, output: Path) -> Path:
    """Concatenate two MP3 files using FFmpeg concat demuxer (stream copy, no re-encode)."""
    list_file = output.parent / f"{output.stem}_concat_list.txt"
    list_file.write_text(
        f"file '{chunk1.as_posix()}'\nfile '{chunk2.as_posix()}'\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            FFMPEG_PATH, "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(output),
        ],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    list_file.unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"[AUDIO] FFmpeg concat failed:\n{result.stderr[-800:]}"
        )
    logger.info(f"[AUDIO] Chunks concatenated -> {output.name}")
    return output


def _tts_request(text: str, voice: str, timeout: int, model: str = "qwen-tts") -> bytes:
    """Make a single Pollinations TTS GET request.
    Mirrors V2 audio-engine.js behaviour exactly:
      - checks Content-Type (HTML/JSON response = error, not audio)
      - checks minimum buffer size (< 1024 bytes = error payload)
      - logs full body on failure for diagnostics
    """
    import json
    text = _preprocess_script(text)  # Fix acronym mispronunciation before TTS
    url = "https://gen.pollinations.ai/v1/audio/speech"
    headers = {
        "Accept": "audio/mpeg, audio/mp3, audio/*, */*",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Origin":  "https://pollinations.ai",
        "Referer": "https://pollinations.ai/",
        "Authorization": f"Bearer {POLLINATIONS_BYOP_KEY}",
    }
    body = json.dumps({
        "model": model,   # caller passes the specific Polly TTS model ID
        "input": text,
        "voice": voice
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            content_type = r.headers.get("Content-Type", "")
            # V2 guard: if server returns HTML/JSON it's an error page, not audio
            if "text/html" in content_type or "application/json" in content_type:
                resp_body = r.read().decode("utf-8", errors="replace").strip()[:300]
                raise RuntimeError(
                    f"[AUDIO] Got non-audio response ({content_type}): {resp_body!r}"
                )
            audio_bytes = r.read()

        # V2 guard: < 1024 bytes is an error payload, not real audio
        if len(audio_bytes) < 1024:
            raise RuntimeError(
                f"[AUDIO] Audio too small ({len(audio_bytes)} bytes) — likely error payload"
            )
        return audio_bytes

    except urllib.error.HTTPError as e:
        # Read response body — Pollinations sends plain-text reason
        # e.g. "Insufficient pollen" or "Character limit exceeded"
        try:
            body = e.read().decode("utf-8", errors="replace").strip()[:400]
        except Exception:
            body = "(could not read error body)"
        logger.warning(
            f"[AUDIO] Pollinations HTTP {e.code} {e.reason} | "
            f"body: {body!r} | chars: {len(text)}"
        )
        raise

# ── Gemini TTS ──────────────────────────────────────────────────────────────

def _inject_gemini_emotion_tags(script: str) -> str:
    """
    Inject Gemini-native [emotion] tags into the script based on sentence content.
    Tags are applied inline — Gemini reads them as performance directions.
    """
    import re
    sentences = _re.split(r'(?<=[.!?])\s+', script.strip())
    result = []
    for i, s in enumerate(sentences):
        s_lower = s.lower()
        if i == 0:
            tag = "[serious] "           # hook always starts grounded
        elif any(k in s_lower for k in ["can't believe", "realized", "found out", "that's when", "shocked"]):
            tag = "[shocked] "
        elif any(k in s_lower for k in ["plan", "decided", "made sure", "so i", "set up"]):
            tag = "[mischievously] "
        elif any(k in s_lower for k in ["humiliated", "caught", "ruined", "walked out", "silence", "stared"]):
            tag = "[satisfied] "
        elif any(k in s_lower for k in ["how dare", "audacity", "claimed", "refused", "she said", "he said"]):
            tag = "[sarcastic] "
        elif any(k in s_lower for k in ["cried", "broke down", "tears"]):
            tag = "[trembling] "
        else:
            tag = ""
        result.append(tag + s)
    return " ".join(result)


def _build_gemini_drama_prompt(script: str) -> str:
    """
    Wrap the script in a full Gemini audio-profile prompt.
    Includes: Audio Profile + Scene + Director's Notes + tagged Transcript.
    Tuned for YouTube Shorts drama/revenge storytelling.
    """
    tagged = _inject_gemini_emotion_tags(script)
    return (
        "# AUDIO PROFILE: The Storyteller\n"
        "\n"
        "## THE SCENE: Late-Night Confession\n"
        "A quiet, dim room. The narrator speaks directly to camera, voice raw and real,\n"
        "like a confession held in too long. No music. Just the truth, finally spoken.\n"
        "\n"
        "### DIRECTOR'S NOTES\n"
        "Style: Emotionally charged confessional storyteller. Voice starts controlled and serious,\n"
        "       builds with rising tension through the conflict, and lands with cold quiet satisfaction\n"
        "       at the revenge payoff. Think true-crime podcast meets Reddit AITA — raw, real, gripping.\n"
        "Pacing: Fast-paced delivery tuned for YouTube Shorts. Punchy short sentences. No dead air.\n"
        "        Slight acceleration through conflict. Brief pause at the turning point.\n"
        "        Crisp and decisive in the resolution. Target: under 55 seconds total.\n"
        "Accent: Neutral American English. Clear, relatable, no affectation.\n"
        "\n"
        "### TRANSCRIPT\n"
        f"{tagged}"
    )


def _call_gemini_tts(text: str, voice: str, timeout: int) -> bytes:
    """
    Gemini 3.1 Flash TTS — Google AI Studio key, zero pollen cost.
      - Sends script wrapped in audio-profile prompt with emotion tags
      - Returns raw PCM (16-bit signed LE, 24 kHz, mono) from the API
      - Converts PCM -> WAV -> MP3 via FFmpeg and returns MP3 bytes
    voice: Gemini voice name (e.g. 'Aoede', 'Charon') — NOT qwen-tts names
    """
    import wave
    from google import genai
    from google.genai import types
    try:
        from config import GEMINI_API_KEY
    except ImportError:
        raise RuntimeError("[AUDIO] GEMINI_API_KEY not in config")
    if not GEMINI_API_KEY:
        raise RuntimeError("[AUDIO] GEMINI_API_KEY is empty — set it in .env")

    # gemini-3.1-flash-tts-preview is only available on the v1beta endpoint!
    client   = genai.Client(api_key=GEMINI_API_KEY, http_options={'api_version': 'v1beta'})
    prompt   = _build_gemini_drama_prompt(text)

    logger.info(f"[AUDIO][Gemini] Generating with voice='{voice}' ...")
    response = client.models.generate_content(
        model="gemini-3.1-flash-tts-preview",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=voice,
                    )
                )
            ),
        ),
    )

    # PCM bytes are already decoded by the SDK (not base64)
    pcm_data = response.candidates[0].content.parts[0].inline_data.data
    logger.info(f"[AUDIO][Gemini] PCM received: {len(pcm_data)//1024} KB")

    # Convert PCM -> WAV -> MP3 via FFmpeg
    tmp_wav = TMP_AUDIO_DIR / "_gemini_tmp.wav"
    tmp_mp3 = TMP_AUDIO_DIR / "_gemini_tmp.mp3"
    try:
        with wave.open(str(tmp_wav), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)          # 16-bit
            wf.setframerate(24000)      # 24 kHz
            wf.writeframes(pcm_data)

        result = subprocess.run(
            [
                FFMPEG_PATH, "-y",
                "-i", str(tmp_wav),
                "-ar", "44100",
                "-b:a", "192k",
                str(tmp_mp3),
            ],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if result.returncode != 0:
            raise RuntimeError(f"[AUDIO][Gemini] FFmpeg WAV->MP3 failed:\n{result.stderr[-400:]}")

        mp3_bytes = tmp_mp3.read_bytes()
        logger.info(f"[AUDIO][Gemini] MP3 ready: {len(mp3_bytes)//1024} KB")
        return mp3_bytes
    finally:
        tmp_wav.unlink(missing_ok=True)
        tmp_mp3.unlink(missing_ok=True)


def _call_cartesia(text: str, voice: str, timeout: int) -> bytes:
    """Fallback Tier 2: Cartesia AI."""
    import json
    from config import CARTESIA_API_KEY
    if not CARTESIA_API_KEY:
        raise RuntimeError("CARTESIA_API_KEY not configured")

    # Mapping qwen-tts voices to Cartesia voice IDs (fallback provider)
    voice_map = {
        "nova":    "e07c00bc-4134-4eae-9ea4-1a55fb45746b",  # warm, female
        "onyx":    "a0e99841-438f-4a64-841c-415bd299ea58",  # deep, male
        "echo":    "a0e99841-438f-4a64-841c-415bd299ea58",  # authoritative
        "fable":   "15d045d1-d24c-47b1-baee-9e90956976ce",  # storytelling
        "alloy":   "15d045d1-d24c-47b1-baee-9e90956976ce",  # energetic
        "shimmer": "e07c00bc-4134-4eae-9ea4-1a55fb45746b",  # bright, female
    }
    voice_id = voice_map.get(voice.lower(), "e07c00bc-4134-4eae-9ea4-1a55fb45746b")

    url = "https://api.cartesia.ai/tts/bytes"
    headers = {
        "Cartesia-Version": "2024-06-10",
        "X-API-Key": CARTESIA_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
    }
    body = json.dumps({
        "model_id": "sonic-english",
        "transcript": text,
        "voice": {"mode": "id", "id": voice_id},
        "output_format": {"container": "mp3", "encoding": "mp3", "sample_rate": 44100}
    }).encode("utf-8")

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def _detect_narrator_gender(script: str) -> str | None:
    """
    Detect narrator gender from relationship signals in the script.
    Returns 'male', 'female', or None (ambiguous).

    Logic: count gender-coded pronouns/relationships.
    If one side scores >= 2 more than the other → confident detection.
    A husband's story uses 'my wife', 'she told me', etc → male narrator.
    A wife's story uses 'my husband', 'he told me', etc → female narrator.
    """
    import re
    s = script.lower()

    # Signals that imply a MALE narrator (he is talking about her)
    male_signals = [
        r'\bmy wife\b', r'\bmy girlfriend\b', r'\bmy ex-wife\b',
        r'\bshe told me\b', r'\bshe said\b', r'\bi told her\b',
        r'\bher to\b', r'\bmy daughter\b', r'\bmy mom\b', r'\bmy mother\b',
        r'\bshe was\b', r'\bshe had\b', r'\bher husband\b',
    ]
    # Signals that imply a FEMALE narrator (she is talking about him)
    female_signals = [
        r'\bmy husband\b', r'\bmy boyfriend\b', r'\bmy ex-husband\b',
        r'\bhe told me\b', r'\bhe said\b', r'\bi told him\b',
        r'\bhim to\b', r'\bmy son\b', r'\bmy dad\b', r'\bmy father\b',
        r'\bhe was\b', r'\bhe had\b', r'\bhis wife\b',
    ]

    male_score   = sum(len(re.findall(p, s)) for p in male_signals)
    female_score = sum(len(re.findall(p, s)) for p in female_signals)

    logger.debug(f"[AUDIO] Gender signals: male={male_score} female={female_score}")

    if male_score >= female_score + 2:
        return "male"
    if female_score >= male_score + 2:
        return "female"
    return None  # ambiguous — use default


def _smart_voice(script: str, requested_voice: str) -> str:
    """
    Override the requested voice if gender detection contradicts it.
    Works for BOTH Pollinations voice names AND Gemini voice names:
      Pollinations female:  nova, shimmer
      Pollinations male:    onyx, echo, fable, alloy
      Gemini female:        Aoede, Kore, Leda, Zephyr
      Gemini male:          Charon, Fenrir, Enceladus, Orion, Puck

    This prevents the #1 immersion-breaker: wrong gender narrator.
    """
    FEMALE_VOICES = {"nova", "shimmer", "Aoede", "Kore", "Leda", "Zephyr"}
    MALE_VOICES   = {"onyx", "echo", "fable", "alloy", "Charon", "Fenrir", "Enceladus", "Orion", "Puck"}

    gender = _detect_narrator_gender(script)

    if gender == "male" and requested_voice in FEMALE_VOICES:
        # Choose correct replacement based on which engine we're on
        replacement = TTS_GEMINI_VOICE_MALE if TTS_MODEL == "gemini-tts" else "onyx"
        logger.info(f"[AUDIO] Gender override: '{requested_voice}' -> '{replacement}' (male narrator)")
        return replacement

    if gender == "female" and requested_voice in MALE_VOICES:
        replacement = TTS_GEMINI_VOICE_FEMALE if TTS_MODEL == "gemini-tts" else "nova"
        logger.info(f"[AUDIO] Gender override: '{requested_voice}' -> '{replacement}' (female narrator)")
        return replacement

    return requested_voice  # no override needed


def _get_pillar_voice(script: str, default_voice: str) -> str:
    """
    Pillar tag mapping — selects correct voice per content pillar.
    Automatically uses Gemini or Pollinations voice names based on TTS_MODEL.
    Falls through to _smart_voice for final gender correction.
    """
    import re
    match = _re.search(r"\[_PILLAR_:(.*?)\]", script, re.IGNORECASE)
    if match:
        pillar = match.group(1).lower().strip()
        if TTS_MODEL == "gemini-tts":
            pillar_map = {
                "history":  TTS_GEMINI_VOICE_MALE,    # Charon — documentary tone
                "drama":    None,                      # defer to gender detection
                "sandbox":  "Puck",                    # upbeat neutral
                "tech":     "Fenrir",                  # direct, technical
            }
        else:  # qwen-tts / Pollinations
            pillar_map = {
                "history":  "onyx",
                "drama":    None,
                "sandbox":  "echo",
                "tech":     "alloy",
            }
        pillar_voice = pillar_map.get(pillar)
        if pillar_voice:
            default_voice = pillar_voice

    # Always run gender correction last — it's the final word
    return _smart_voice(script, default_voice)


# ── Main engine ─────────────────────────────────────────────────────────────


# Polly TTS model fallback chain (IDs verified live gen.pollinations.ai/v1/models June 2026)
# Ordered: highest quality stable → fastest → multilingual safety nets
_TTS_POLLY_MODELS = [
    "qwen-tts",              # Primary Polly TTS — Qwen multi-voice
    "qwen-tts-instruct",     # Instruction-following variant
    "elevenflash",           # ElevenLabs Flash — low latency, high quality
    "elevenlabs",            # ElevenLabs standard — premium
    "eleven-multilingual-v2", # ElevenLabs multilingual safety net
]


def _call_polly_tts_cascade(text: str, voice: str, timeout: int) -> bytes:
    """
    Try each Polly TTS model in order, returning bytes from the first success.
    Raises RuntimeError if all models fail.
    """
    last_error = None
    for model in _TTS_POLLY_MODELS:
        try:
            logger.info(f"[AUDIO][Polly] Trying TTS model: {model}")
            audio_bytes = _tts_request(text, voice, timeout, model=model)
            logger.info(f"[AUDIO][Polly] TTS OK via {model}")
            return audio_bytes
        except Exception as e:
            logger.warning(f"[AUDIO][Polly] {model} failed: {e} — next...")
            last_error = e
    raise RuntimeError(f"[AUDIO] All Polly TTS models exhausted. Last error: {last_error}")


class AudioEngine:

    MAX_RETRIES  = 3
    BASE_BACKOFF = 5  # seconds

    # ── Normal generate ─────────────────────────────────────────────────────

    def generate(self, script_text: str, video_id: str, voice: str = "nova") -> Path:
        """
        Generate full TTS audio.
        Primary:  Gemini 3.1 Flash TTS (if TTS_MODEL == 'gemini-tts')
        Fallback: Pollinations qwen-tts (BYOP, checkpoint/resume on 403)
        """
        output_path     = TMP_AUDIO_DIR / f"{video_id}.mp3"
        effective_voice = _get_pillar_voice(script_text, voice or TTS_VOICE)

        # For Gemini, map semantic names (nova/onyx) to actual Gemini voice names
        if TTS_MODEL == "gemini-tts":
            _GEMINI_VOICE_MAP = {
                "nova":    TTS_GEMINI_VOICE_FEMALE,   # Aoede
                "shimmer": TTS_GEMINI_VOICE_FEMALE,
                "onyx":    TTS_GEMINI_VOICE_MALE,     # Charon
                "echo":    TTS_GEMINI_VOICE_MALE,
                "alloy":   "Puck",
                "fable":   "Fenrir",
            }
            effective_voice = _GEMINI_VOICE_MAP.get(effective_voice, effective_voice)

        # Cache hit with integrity check
        if output_path.exists():
            size = output_path.stat().st_size
            if size >= MIN_VALID_AUDIO_BYTES:
                logger.info(f"[AUDIO] Cache hit: {output_path.name} ({size / 1024:.1f} KB)")
                return output_path
            logger.warning(f"[AUDIO] Cache corrupted ({size} B) — deleting.")
            output_path.unlink(missing_ok=True)

        # ── Gemini TTS path ────────────────────────────────────────────────
        if TTS_MODEL == "gemini-tts":
            for attempt in range(1, self.MAX_RETRIES + 1):
                logger.info(
                    f"[AUDIO][Gemini] Attempt {attempt}/{self.MAX_RETRIES} voice={effective_voice}"
                )
                try:
                    audio_bytes = _call_gemini_tts(script_text, effective_voice, TTS_TIMEOUT_S)
                    output_path.write_bytes(audio_bytes)
                    logger.info(f"[AUDIO][Gemini] OK: {output_path.name} ({len(audio_bytes)//1024} KB)")
                    return output_path
                except Exception as e:
                    logger.warning(f"[AUDIO][Gemini] Attempt {attempt} failed: {e}")
                    if attempt < self.MAX_RETRIES:
                        time.sleep(5)
            # All Gemini attempts failed — fall through to Pollinations
            logger.warning("[AUDIO][Gemini] All attempts failed. Falling back to Pollinations...")
            effective_voice = "nova" if TTS_GEMINI_VOICE_FEMALE in effective_voice else "onyx"

        # ── Pollinations TTS cascade ───────────────────────────────────────────
        from engine.balance import byop_has_credits
        credits_ok = byop_has_credits()

        if credits_ok:
            for attempt in range(1, self.MAX_RETRIES + 1):
                logger.info(f"[AUDIO] Polly TTS attempt {attempt}/{self.MAX_RETRIES} — voice: {effective_voice}")
                try:
                    audio_bytes = _call_polly_tts_cascade(script_text, effective_voice, TTS_TIMEOUT_S)
                    output_path.write_bytes(audio_bytes)
                    logger.info(f"[AUDIO] OK: {output_path.name} ({len(audio_bytes)//1024} KB)")
                    return output_path

                except urllib.error.HTTPError as e:
                    if e.code == 403:
                        return self._handle_byop_exhausted(script_text, video_id, effective_voice)
                    logger.warning(f"[AUDIO] HTTP {e.code} on attempt {attempt} -- waiting 10s...")

                except Exception as e:
                    logger.warning(f"[AUDIO] Attempt {attempt} {type(e).__name__}: {e} -- waiting 10s...")

                if attempt < self.MAX_RETRIES:
                    time.sleep(10)

            logger.warning("[AUDIO] Polly TTS cascade failed 3 times. Trying Cartesia...")

        # ── Cartesia final TTS fallback ────────────────────────────────────────
        try:
            audio_bytes = _call_cartesia(script_text, effective_voice, TTS_TIMEOUT_S)
            if len(audio_bytes) >= MIN_VALID_AUDIO_BYTES:
                output_path.write_bytes(audio_bytes)
                logger.info(f"[AUDIO] OK via Cartesia: {output_path.name}")
                return output_path
            raise RuntimeError(f"Cartesia returned too-small audio ({len(audio_bytes)} B)")
        except Exception as e:
            logger.error(f"[AUDIO] Cartesia also failed: {e}")
            return self._handle_byop_exhausted(script_text, video_id, effective_voice)


    # ── Resume generate (chunk 2 only) ──────────────────────────────────────

    def generate_resume(
        self,
        remaining_script: str,
        video_id: str,
        chunk1_path: Path,
        voice: str = "nova",
    ) -> Path:
        """
        Resume after a partial audio save.
        Generates chunk 2, then concatenates chunk1 + chunk2 into the final MP3.
        """
        output_path     = TMP_AUDIO_DIR / f"{video_id}.mp3"
        chunk2_path     = TMP_AUDIO_DIR / f"{video_id}_chunk2.mp3"
        effective_voice = _get_pillar_voice(remaining_script, voice or TTS_VOICE)

        if output_path.exists() and output_path.stat().st_size >= MIN_VALID_AUDIO_BYTES:
            logger.info(f"[AUDIO] Resumed — full audio already complete: {output_path.name}")
            return output_path

        logger.info(
            f"[AUDIO] Resuming {video_id} — generating chunk 2 "
            f"({len(remaining_script.split())} words)..."
        )

        from engine.balance import byop_has_credits
        credits_ok = byop_has_credits()

        chunk2_success = False

        if credits_ok:
            for attempt in range(1, self.MAX_RETRIES + 1):
                logger.info(f"[AUDIO] Chunk 2 attempt {attempt}/{self.MAX_RETRIES}")
                try:
                    audio_bytes = _tts_request(remaining_script, effective_voice, TTS_TIMEOUT_S)
                    if len(audio_bytes) < MIN_VALID_AUDIO_BYTES:
                        raise ValueError(f"Chunk 2 response too small ({len(audio_bytes)} B)")

                    tmp = chunk2_path.with_suffix(".tmp")
                    tmp.write_bytes(audio_bytes)
                    tmp.rename(chunk2_path)
                    logger.info(f"[AUDIO] Chunk 2 saved: {chunk2_path.name}")
                    chunk2_success = True
                    break

                except urllib.error.HTTPError as e:
                    if e.code == 403:
                        logger.warning("[AUDIO] balance < 0.04 pollen. Skipping...")
                        raise RuntimeError("[AUDIO] BYOP 403 on chunk 2")
                    wait = self.BASE_BACKOFF * attempt
                    logger.warning(f"[AUDIO] Chunk 2 attempt {attempt} HTTP {e.code}. Retry in {wait}s...")
                    time.sleep(wait)

                except Exception as e:
                    wait = self.BASE_BACKOFF * attempt
                    logger.warning(f"[AUDIO] Chunk 2 attempt {attempt} {type(e).__name__}: {e}. Retry in {wait}s...")
                    time.sleep(wait)
        else:
            logger.warning("[AUDIO] balance < 0.04 pollen. Skipping...")

        if not chunk2_success:
            logger.warning("[AUDIO] Pollinations chunk 2 logic exhausted. Skipping...")
            raise RuntimeError("[AUDIO] Pollinations chunk 2 exhausted.")


        # Concatenate both chunks into the final output
        final = _concat_audio(chunk1_path, chunk2_path, output_path)

        # Clean up chunk files
        chunk1_path.unlink(missing_ok=True)
        chunk2_path.unlink(missing_ok=True)
        logger.info(f"[AUDIO] Final audio ready: {final.name} (chunks merged)")
        return final

    # ── BYOP exhausted handler ──────────────────────────────────────────────

    def _handle_byop_exhausted(
        self, script_text: str, video_id: str, voice: str
    ) -> Path:
        """
        Split script in half. Try chunk 1.
        If chunk 1 succeeds -> raise AudioPartialError (pipeline saves state + pauses).
        If chunk 1 also 403 -> balance is truly zero, raise RuntimeError.
        """
        part1, part2 = _split_at_sentence(script_text)
        chunk1_path  = TMP_AUDIO_DIR / f"{video_id}_chunk1.mp3"

        logger.info(
            f"[AUDIO] Chunk 1: {len(part1.split())} words | "
            f"Chunk 2: {len(part2.split())} words"
        )

        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                audio_bytes = _tts_request(part1, voice, TTS_TIMEOUT_S)
                if len(audio_bytes) < MIN_VALID_AUDIO_BYTES:
                    raise ValueError(f"Chunk 1 too small ({len(audio_bytes)} B)")

                tmp = chunk1_path.with_suffix(".tmp")
                tmp.write_bytes(audio_bytes)
                tmp.rename(chunk1_path)
                logger.info(
                    f"[AUDIO] Chunk 1 saved ({len(audio_bytes) / 1024:.1f} KB). "
                    f"Raising AudioPartialError — pipeline will pause."
                )
                raise AudioPartialError(chunk1_path, part2)

            except AudioPartialError:
                raise  # propagate immediately

            except urllib.error.HTTPError as e:
                if e.code == 403:
                    raise RuntimeError(
                        f"[AUDIO] BYOP 403 on chunk 1 as well — "
                        f"balance is fully depleted. Top up pollen and retry."
                    )
                wait = self.BASE_BACKOFF * attempt
                logger.warning(f"[AUDIO] Chunk 1 attempt {attempt} HTTP {e.code}. Retry in {wait}s...")
                time.sleep(wait)

            except Exception as e:
                wait = self.BASE_BACKOFF * attempt
                logger.warning(f"[AUDIO] Chunk 1 attempt {attempt} {type(e).__name__}: {e}. Retry in {wait}s...")
                time.sleep(wait)

        raise RuntimeError(f"[AUDIO] All {self.MAX_RETRIES} chunk 1 attempts exhausted for: {video_id}")
