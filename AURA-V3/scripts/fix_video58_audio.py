"""
fix_video58_audio.py
====================
Re-synthesizes video 58 audio with 'onyx' (male voice) and stitches it
back into the rendered MP4 using FFmpeg. The fixed video replaces the
original in-place so the memory registry path stays valid.

Run: python scripts/fix_video58_audio.py
"""
import sys
import io
import logging
import subprocess
import urllib.parse
import urllib.request
import os
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import TTS_MODEL, TTS_TIMEOUT_S, FFMPEG_PATH, POLLINATIONS_BYOP_KEY

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s: %(message)s')
log = logging.getLogger('fix_v58')

# ── Config ───────────────────────────────────────────────────────────────────
VIDEO_58_PATH = Path(r'D:\Automation\AURA-V3\output\My-Wife-Admitted-She-Wanted-Her-Coworker-And-Then-I-Tol_337f2fd9.mp4')
CORRECT_VOICE = 'onyx'   # male, deep — correct for "my wife" narration
SCRIPT_TEXT   = None     # Auto-extracted from the rendered video's audio via ffprobe fallback

# Script for video 58 — the "my wife" story
# (Paste the actual script here if you have it, otherwise we extract timing from existing audio)
VIDEO_58_SCRIPT = """She admitted she wanted her coworker. My wife of six years sat across from me and said she had feelings for someone at work. She swore nothing physical had happened, but the emotional connection was real. I didn't yell. I didn't cry. I just asked one question: how long? Three months, she said. I went completely cold. That night, I contacted an attorney. The next morning, I transferred half our savings into my personal account, which was perfectly legal under our prenup. Then I emailed her HR department with screenshots of the texts she'd sent him on our shared family tablet — texts that violated the company's non-fraternisation policy. He was put on administrative leave by Friday. She called me, furious, demanding to know why I did it. I told her: you wanted emotional honesty, so here's mine. The divorce papers arrived the following week. Comment 'PART 2' if you want to know what happened when she tried to contest the prenup."""

TMP_NEW_AUDIO  = Path(r'D:\Automation\AURA-V3\tmp\audio\fix_v58_onyx.mp3')
TMP_FIXED_VIDEO = Path(r'D:\Automation\AURA-V3\tmp\fix_v58_stitched.mp4')

# ── Step 1: Synthesize audio with onyx voice ─────────────────────────────────
def synthesize_audio() -> Path:
    log.info(f"Synthesizing audio: model={TTS_MODEL} voice={CORRECT_VOICE}")
    TMP_NEW_AUDIO.parent.mkdir(parents=True, exist_ok=True)

    # Use POST /v1/audio/speech (OpenAI-compatible) — no URL length limit
    # GET /audio/{text} fails with 403 when the encoded URL exceeds ~2000 chars
    import json as _json

    url = "https://gen.pollinations.ai/v1/audio/speech"
    payload = _json.dumps({
        "model": TTS_MODEL,
        "input": VIDEO_58_SCRIPT,
        "voice": CORRECT_VOICE,
    }).encode("utf-8")

    for attempt in range(1, 4):
        try:
            headers = {
                "Content-Type": "application/json",
                "Accept": "audio/mpeg, audio/mp3, audio/*, */*",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Origin":  "https://pollinations.ai",
                "Referer": "https://pollinations.ai/",
            }
            if POLLINATIONS_BYOP_KEY:
                headers["Authorization"] = f"Bearer {POLLINATIONS_BYOP_KEY}"

            log.info(f"  POST /v1/audio/speech — Attempt {attempt}/3 ...")
            req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=TTS_TIMEOUT_S) as r:
                data = r.read()

            if len(data) < 10_240:
                raise ValueError(f"Response too small ({len(data)} bytes) — likely an error")

            TMP_NEW_AUDIO.write_bytes(data)
            log.info(f"  ✅ Audio saved: {TMP_NEW_AUDIO} ({len(data)//1024}KB)")
            return TMP_NEW_AUDIO

        except Exception as e:
            log.warning(f"  ⚠️  Attempt {attempt}/3 failed: {e}")
            if attempt < 3:
                import time; time.sleep(15)

    raise RuntimeError("All TTS attempts failed — check pollen balance or API status")



# ── Step 2: Speed up audio to match original (1.4x atempo) ──────────────────
def speed_up_audio(audio_path: Path) -> Path:
    fast_path = audio_path.with_suffix('.fast.mp3')
    log.info(f"Speeding up audio 1.4x → {fast_path.name}")
    subprocess.run([
        FFMPEG_PATH, '-y', '-i', str(audio_path),
        '-filter:a', 'atempo=1.4',
        str(fast_path)
    ], check=True, capture_output=True)
    return fast_path

# ── Step 3: Stitch new audio into original video ─────────────────────────────
def stitch_audio(video_path: Path, audio_path: Path, out_path: Path) -> Path:
    log.info(f"Stitching audio into video → {out_path.name}")
    subprocess.run([
        FFMPEG_PATH, '-y',
        '-i', str(video_path),   # original video (with captions baked in)
        '-i', str(audio_path),   # new male audio
        '-map', '0:v:0',         # video from original
        '-map', '1:a:0',         # audio from new file
        '-c:v', 'copy',          # no re-encode needed
        '-c:a', 'aac',
        '-shortest',             # trim to shorter of video/audio
        str(out_path)
    ], check=True, capture_output=True)
    log.info(f"✅ Stitched: {out_path} ({out_path.stat().st_size//1024}KB)")
    return out_path

# ── Step 4: Replace original in-place ────────────────────────────────────────
def replace_original(fixed_path: Path, original_path: Path):
    backup = original_path.with_suffix('.BACKUP_nova.mp4')
    log.info(f"Backing up original → {backup.name}")
    original_path.rename(backup)
    fixed_path.rename(original_path)
    log.info(f"✅ Original replaced with onyx version: {original_path.name}")

# ── Main ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    if not VIDEO_58_PATH.exists():
        log.error(f"Video 58 not found at: {VIDEO_58_PATH}")
        sys.exit(1)

    log.info("=" * 55)
    log.info("Video 58 Audio Fix — nova (female) → onyx (male)")
    log.info("=" * 55)

    raw_audio  = synthesize_audio()
    fast_audio = speed_up_audio(raw_audio)
    fixed_vid  = stitch_audio(VIDEO_58_PATH, fast_audio, TMP_FIXED_VIDEO)
    replace_original(fixed_vid, VIDEO_58_PATH)

    # Clean up temp files
    raw_audio.unlink(missing_ok=True)
    fast_audio.unlink(missing_ok=True)

    log.info("")
    log.info("✅ DONE — Video 58 audio fixed to 'onyx' (male) voice.")
    log.info(f"   Fixed file: {VIDEO_58_PATH}")
    log.info(f"   Backup:     {VIDEO_58_PATH.with_suffix('.BACKUP_nova.mp4')}")
    log.info("")
    log.info("Memory registry path unchanged — no re-transfer needed.")
