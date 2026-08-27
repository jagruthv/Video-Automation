"""
Scans every clip in the Pinterest vault, detects static/image-like videos
(single frame, <1fps, or <2s duration), removes them, clears the concat cache,
then re-renders video 39 from existing audio chunks.

Run: python purge_and_rerender.py
"""
import subprocess, json, shutil, os
from pathlib import Path

VAULT_DIR  = Path(r"d:\Automation\n8n\asmr-qa-vault\public\accepted_vault")
CACHE_DIR  = Path("tmp/vault_cache")
FFPROBE    = "ffprobe"

# ── Step 1: Scan and purge ───────────────────────────────────────────────────
print(f"\n[PURGE] Scanning {VAULT_DIR} ...")
clips = list(VAULT_DIR.rglob("*.mp4")) + list(VAULT_DIR.rglob("*.mov")) + list(VAULT_DIR.rglob("*.mkv"))
print(f"[PURGE] {len(clips)} clips found.\n")

deleted = []
kept    = []

for clip in clips:
    try:
        result = subprocess.run([
            FFPROBE, "-v", "quiet", "-print_format", "json",
            "-show_streams", "-show_format", str(clip)
        ], capture_output=True, text=True, timeout=15)
        data = json.loads(result.stdout)

        duration = float(data.get("format", {}).get("duration", 0))
        streams  = data.get("streams", [])
        video_s  = next((s for s in streams if s.get("codec_type") == "video"), None)

        if not video_s:
            print(f"  [DELETE] {clip.name} — NO video stream")
            clip.unlink(missing_ok=True)
            deleted.append(clip.name)
            continue

        # Get real fps
        fps_raw = video_s.get("r_frame_rate", "0/1")
        try:
            num, den = map(int, fps_raw.split("/"))
            fps = num / den if den else 0
        except Exception:
            fps = 0

        nb_frames = int(video_s.get("nb_frames", 0) or 0)

        is_static = (
            duration < 2.0          # shorter than 2 seconds
            or fps < 1.0            # less than 1 frame per second (slideshow)
            or nb_frames <= 2       # literally just 1-2 frames (still image)
        )

        if is_static:
            reason = f"duration={duration:.2f}s fps={fps:.2f} frames={nb_frames}"
            print(f"  [DELETE] {clip.name} — STATIC ({reason})")
            clip.unlink(missing_ok=True)
            deleted.append(clip.name)
        else:
            kept.append(clip)

    except Exception as e:
        print(f"  [SKIP]   {clip.name} — probe error: {e}")

print(f"\n[PURGE] Deleted {len(deleted)} static clips. Kept {len(kept)} valid clips.")

# ── Step 2: Clear concat cache so next render picks fresh clips ──────────────
if CACHE_DIR.exists():
    shutil.rmtree(CACHE_DIR)
    print(f"[PURGE] Cleared concat cache: {CACHE_DIR}")

# ── Step 3: Re-render video 39 from existing audio ───────────────────────────
print("\n[RECOVER] Starting re-render of video 39...\n")

VIDEO_ID   = "337f2fd96fd41c3b"
AUDIO_DIR  = Path("tmp/audio")
OUTPUT_DIR = Path("output")

c1 = AUDIO_DIR / f"{VIDEO_ID}_c1.mp3"
p2 = AUDIO_DIR / f"{VIDEO_ID}_p2.mp3"
p3 = AUDIO_DIR / f"{VIDEO_ID}_p3.mp3"
available = [f for f in [c1, p2, p3] if f.exists()]

if not available:
    raise SystemExit("[RECOVER] ERROR: No audio chunks found!")

print(f"[RECOVER] Audio chunks: {[f.name for f in available]}")

concat_list = AUDIO_DIR / f"{VIDEO_ID}_recover_concat.txt"
concat_path = AUDIO_DIR / f"{VIDEO_ID}_full.mp3"

with open(concat_list, "w") as f:
    for chunk in available:
        f.write(f"file '{chunk.resolve()}'\n")

subprocess.run([
    "ffmpeg", "-y", "-f", "concat", "-safe", "0",
    "-i", str(concat_list), "-c", "copy", str(concat_path)
], check=True, capture_output=True)

size_kb = concat_path.stat().st_size / 1024
print(f"[RECOVER] Audio merged: {concat_path.name} ({size_kb:.0f} KB)")

from engine.vault import VaultManager
from engine.compositor import FFmpegCompositor

vault = VaultManager()
comp  = FFmpegCompositor()

audio_dur = comp.probe_audio_duration(concat_path)
source_s  = (audio_dur / comp.TTS_SPEED) * comp.VIDEO_SPEED
clip      = vault.pick_clip(needed_source_s=source_s)

print(f"[RECOVER] Picked clip: {clip.path.name}  is_large={clip.is_large}  seek={clip.seek_start:.0f}s")

title  = "My wife said she was sorely tempted to cheat on me with"
output = comp.render(clip, concat_path, VIDEO_ID, title=title)

size_mb = output.stat().st_size / 1024 / 1024
# Quick validation with ffprobe
probe = subprocess.run([
    FFPROBE, "-v", "error", "-show_entries", "format=size,duration",
    "-of", "default=noprint_wrappers=1", str(output)
], capture_output=True, text=True)
print(f"[RECOVER] ffprobe: {probe.stdout.strip()}")

if size_mb < 5:
    raise SystemExit(f"[RECOVER] ERROR: Output is suspiciously small ({size_mb:.1f} MB) — check logs!")

print(f"\n[RECOVER] SUCCESS: {output.name}  ({size_mb:.1f} MB)")
