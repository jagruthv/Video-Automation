"""
engine/forges/audio_forge.py -- AURA-V3 Audio Forge
====================================================
Converts Audio_Narration text -> MP3 via Pollinations TTS (free, no key),
then applies TTS_SPEED via FFmpeg atempo filter.

Pipeline per block:
  1. Download raw TTS audio -> block_XXX_raw.mp3  (cached)
     Uses requests library for robust chunked-transfer handling.
  2. Validate: MP3 magic bytes + minimum size
  3. Apply atempo speed-up -> block_XXX.mp3        (cached)
  4. Probe final duration via ffprobe
  5. Return (final_path, final_duration_secs)

Rate-limit guard:
  On HTTP 429 or tiny response (< 2KB), sleep TTS_BACKOFF_SECS and retry.
  Pipeline NEVER crashes from a rate-limit.

Valid Pollinations TTS voices (openai-audio model):
  alloy | echo | fable | onyx | nova | shimmer
"""

import logging
import shutil
import subprocess
import time
import traceback
import urllib.parse
from pathlib import Path

import requests as _requests

import config
from models import TimelineBlock

logger = logging.getLogger("aura.forge.audio")

_MIN_AUDIO_BYTES = 2_000   # anything smaller is an error page / rate-limit response


# -----------------------------------------------------------------------
# URL BUILDER
# -----------------------------------------------------------------------

def _tts_url(text: str) -> str:
    """
    Build the Pollinations TTS URL.
    Correct base: gen.pollinations.ai/audio/ (from working engine/audio.py)
    Format: GET https://gen.pollinations.ai/audio/{encoded}?model={model}&voice={voice}
    """
    encoded = urllib.parse.quote(text)
    url = (
        f"https://gen.pollinations.ai/audio/{encoded}"
        f"?model={config.TTS_MODEL}"
        f"&voice={config.TTS_VOICE}"
    )
    logger.debug(f"[AUDIO] TTS URL preview: {url[:110]}...")
    return url


# -----------------------------------------------------------------------
# DURATION PROBE
# -----------------------------------------------------------------------

def _probe_duration(path: Path) -> float:
    """Return audio/video duration in seconds via ffprobe."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error",
             "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1",
             str(path)],
            capture_output=True, text=True, timeout=15,
        )
        raw = r.stdout.strip()
        if not raw:
            raise ValueError("ffprobe returned empty string")
        val = float(raw)
        if val <= 0:
            raise ValueError(f"ffprobe returned invalid duration: {val}")
        return val
    except Exception as exc:
        logger.error(
            f"[AUDIO] ffprobe failed for '{path.name}': {exc}\n"
            f"  File size: {path.stat().st_size if path.exists() else 'missing'} bytes.\n"
            f"  This usually means the file is corrupt or not a valid media file.",
            exc_info=True,
        )
        return 0.0


# -----------------------------------------------------------------------
# RATE-LIMIT SLEEP
# -----------------------------------------------------------------------

def _sleep_ratelimit(block_id: int) -> None:
    """Sleep TTS_BACKOFF_SECS and log the wakeup time clearly."""
    import datetime
    wake_at = datetime.datetime.now() + datetime.timedelta(seconds=config.TTS_BACKOFF_SECS)
    logger.warning(
        f"[AUDIO] Block {block_id}: rate-limited. "
        f"Sleeping {config.TTS_BACKOFF_SECS}s. "
        f"Will retry at {wake_at.strftime('%H:%M:%S')} ..."
    )
    time.sleep(config.TTS_BACKOFF_SECS)


# -----------------------------------------------------------------------
# DOWNLOADER  (uses requests for robust chunked-transfer handling)
# -----------------------------------------------------------------------

def _download_raw(url: str, out: Path, block_id: int, word_count: int) -> None:
    """
    Download TTS audio with infinite rate-limit retry.

    Uses `requests` with iter_content() instead of urllib.request.
    This correctly handles Pollinations' chunked transfer-encoding
    without raising IncompleteRead when the server closes early.
    """
    headers = {
        "Accept"        : "audio/mpeg, audio/mp3, audio/*, */*",
        "User-Agent"    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
        "Authorization" : f"Bearer {config.POLLINATIONS_BYOP_KEY or ''}",
    }
    attempt = 0

    while True:
        attempt += 1
        logger.info(
            f"[AUDIO] Block {block_id}: TTS attempt {attempt} "
            f"(~{word_count} words, voice={config.TTS_VOICE}) ..."
        )

        try:
            resp = _requests.get(
                url,
                headers=headers,
                stream=True,
                timeout=config.TTS_TIMEOUT_S,
            )

            status       = resp.status_code
            content_type = resp.headers.get("Content-Type", "unknown")

            # Collect all streamed chunks
            chunks = []
            for chunk in resp.iter_content(chunk_size=65536):
                if chunk:
                    chunks.append(chunk)
            data = b"".join(chunks)

            size_kb = len(data) / 1024
            logger.info(
                f"[AUDIO] Block {block_id}: status={status}, "
                f"content-type={content_type}, size={size_kb:.1f} KB"
            )

            # --- Validate status -----------------------------------------
            if status == 429:
                logger.warning(f"[AUDIO] Block {block_id}: HTTP 429 rate-limit.")
                _sleep_ratelimit(block_id)
                continue

            if status != 200:
                logger.warning(
                    f"[AUDIO] Block {block_id}: non-200 status {status}. "
                    f"Body preview: {data[:200]!r}. Retrying in 30s..."
                )
                time.sleep(30)
                continue

            # --- Content-type guard (from engine/audio.py) ---------------
            # If server returns HTML or JSON, it's an error page, not audio.
            # Do NOT waste 30s sleeping — just retry immediately.
            if "text/html" in content_type or "application/json" in content_type:
                preview = data[:300].decode("utf-8", errors="replace").strip()
                logger.warning(
                    f"[AUDIO] Block {block_id}: got non-audio response "
                    f"({content_type}). Preview: {preview!r}. "
                    f"URL or BYOP key may be wrong. Retrying in 10s..."
                )
                time.sleep(10)
                continue

            # --- Validate size --------------------------------------------
            if len(data) < _MIN_AUDIO_BYTES:
                logger.warning(
                    f"[AUDIO] Block {block_id}: response only {len(data)} bytes "
                    f"(minimum {_MIN_AUDIO_BYTES}). "
                    f"Body: {data[:200]!r}. Treating as rate-limit."
                )
                _sleep_ratelimit(block_id)
                continue

            # --- Validate MP3 magic bytes ---------------------------------
            # Valid MP3: starts with ID3 tag, OR with 0xFF 0xFB/0xFA/0xF3 sync
            is_mp3 = (
                data[:3] == b"ID3"
                or (len(data) >= 2 and data[0] == 0xFF and data[1] in (0xFA, 0xFB, 0xF3))
            )
            if not is_mp3:
                logger.warning(
                    f"[AUDIO] Block {block_id}: response is NOT valid MP3 "
                    f"(first 8 bytes: {data[:8].hex()}). "
                    f"Body preview: {data[:200]!r}. "
                    f"Could be wrong model/voice. Retrying in 30s..."
                )
                time.sleep(30)
                continue

            # --- SUCCESS --------------------------------------------------
            out.write_bytes(data)
            logger.info(
                f"[AUDIO] Block {block_id}: raw TTS saved "
                f"({size_kb:.1f} KB) -> {out.name}"
            )
            return

        except _requests.exceptions.Timeout:
            logger.error(
                f"[AUDIO] Block {block_id}: request timed out after "
                f"{config.TTS_TIMEOUT_S}s. Retrying in 30s..."
            )
            time.sleep(30)

        except _requests.exceptions.ConnectionError as exc:
            logger.error(
                f"[AUDIO] Block {block_id}: connection error - {exc}. "
                f"Check internet connectivity. Retrying in 30s..."
            )
            time.sleep(30)

        except _requests.exceptions.HTTPError as exc:
            code = exc.response.status_code if exc.response else "?"
            if code == 429:
                _sleep_ratelimit(block_id)
            else:
                logger.error(
                    f"[AUDIO] Block {block_id}: HTTP error {code} - {exc}. "
                    f"Retrying in 30s..."
                )
                time.sleep(30)

        except Exception as exc:
            logger.error(
                f"[AUDIO] Block {block_id}: unexpected error - {exc}",
                exc_info=True,
            )
            time.sleep(30)


# -----------------------------------------------------------------------
# SPEED-UP VIA ATEMPO
# -----------------------------------------------------------------------

def _apply_speed(raw: Path, fast: Path, block_id: int) -> None:
    """
    Apply TTS_SPEED via FFmpeg atempo.
    atempo only accepts 0.5-2.0. Values > 2.0 are split into two passes.
    e.g., 2.8x = atempo=1.4,atempo=2.0
    """
    speed = config.TTS_SPEED

    if speed == 1.0:
        logger.debug(f"[AUDIO] Block {block_id}: TTS_SPEED=1.0, skipping atempo")
        shutil.copy2(str(raw), str(fast))
        return

    if speed <= 2.0:
        atempo = f"atempo={speed}"
    else:
        atempo = f"atempo=2.0,atempo={round(speed / 2.0, 4)}"

    logger.info(
        f"[AUDIO] Block {block_id}: applying {speed}x speed "
        f"(filter: {atempo}) -> {fast.name}"
    )

    result = subprocess.run(
        ["ffmpeg", "-y", "-v", "error",
         "-i", str(raw),
         "-filter:a", atempo,
         "-c:a", "libmp3lame", "-q:a", "2",
         str(fast)],
        capture_output=True, text=True, timeout=60,
    )

    if result.returncode != 0:
        logger.error(
            f"[AUDIO] Block {block_id}: atempo FAILED (exit {result.returncode}):\n"
            f"  STDERR: {result.stderr.strip()}\n"
            f"  Falling back to raw (un-sped) audio."
        )
        shutil.copy2(str(raw), str(fast))
    else:
        logger.info(f"[AUDIO] Block {block_id}: speed-up done -> {fast.name}")


# -----------------------------------------------------------------------
# PUBLIC API
# -----------------------------------------------------------------------

def generate(block: TimelineBlock) -> tuple[Path, float]:
    """
    Generate TTS audio for one block with speed-up applied.

    Returns:
        (mp3_path, duration_seconds)
    """
    word_count = len(block.Audio_Narration.split())
    natural_s  = round(word_count / 150 * 60, 1)

    logger.info(
        f"[AUDIO] Block {block.Block_ID}: starting TTS "
        f"({word_count} words, ~{natural_s}s natural, "
        f"~{natural_s / config.TTS_SPEED:.1f}s at {config.TTS_SPEED}x)"
    )

    raw_path  = config.TMP_AUDIO_DIR / f"block_{block.Block_ID:03d}_raw.mp3"
    fast_path = config.TMP_AUDIO_DIR / f"block_{block.Block_ID:03d}.mp3"

    # Step 1: Download raw TTS (cached)
    if raw_path.exists() and raw_path.stat().st_size > _MIN_AUDIO_BYTES:
        logger.info(f"[AUDIO] Block {block.Block_ID}: raw TTS cache hit ({raw_path.name})")
    else:
        _download_raw(_tts_url(block.Audio_Narration), raw_path, block.Block_ID, word_count)

    # Step 2: Apply speed-up (cached)
    if fast_path.exists() and fast_path.stat().st_size > _MIN_AUDIO_BYTES:
        logger.info(f"[AUDIO] Block {block.Block_ID}: sped audio cache hit ({fast_path.name})")
    else:
        _apply_speed(raw_path, fast_path, block.Block_ID)

    # Step 3: Probe final duration
    duration = _probe_duration(fast_path)
    if duration <= 0:
        raise RuntimeError(
            f"[AUDIO] Block {block.Block_ID}: final audio duration is 0 or invalid. "
            f"File: {fast_path} ({fast_path.stat().st_size} bytes). "
            f"Delete cache files and retry."
        )

    logger.info(
        f"[AUDIO] Block {block.Block_ID}: DONE -- "
        f"{duration:.2f}s at {config.TTS_SPEED}x ({fast_path.name})"
    )
    return fast_path, duration


def generate_all(blocks: list[TimelineBlock]) -> dict[int, tuple[Path, float]]:
    """
    Generate TTS for all blocks sequentially.

    Returns:
        {Block_ID: (mp3_path, duration_secs)}
    """
    logger.info(f"[AUDIO] Generating TTS for {len(blocks)} blocks ...")
    results: dict[int, tuple[Path, float]] = {}

    for i, block in enumerate(blocks, 1):
        logger.info(f"[AUDIO] -- Block {block.Block_ID} ({i}/{len(blocks)}) --")
        try:
            results[block.Block_ID] = generate(block)
        except Exception as exc:
            logger.critical(
                f"[AUDIO] Block {block.Block_ID} FAILED -- pipeline cannot continue.\n"
                f"  Error: {exc}\n"
                f"  Traceback:\n{traceback.format_exc()}"
            )
            raise

    total_dur = sum(v[1] for v in results.values())
    logger.info(
        f"[AUDIO] All {len(blocks)} blocks done. "
        f"Total timeline: {total_dur:.1f}s ({total_dur/60:.1f} min)"
    )
    return results
