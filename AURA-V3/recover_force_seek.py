"""
Force re-render of video 39 using kinetic sand with a seek PAST 15 minutes
to skip the frozen section at ~280s (4.6 min) in the 12-hour clip.
"""
import subprocess, random
from pathlib import Path

VIDEO_ID          = "337f2fd96fd41c3b"
AUDIO_DIR         = Path("tmp/audio")
KINETIC_SAND_PATH = Path(r"D:\Automation\n8n\kinetic_sand_vault_1.mp4")
FFPROBE           = "ffprobe"

# ── Merge audio ──────────────────────────────────────────────────────────────
available = [AUDIO_DIR / f"{VIDEO_ID}_{x}.mp3" for x in ["c1","p2","p3"]]
available = [f for f in available if f.exists()]
print(f"[RECOVER] Audio chunks: {[f.name for f in available]}")

concat_list = AUDIO_DIR / f"{VIDEO_ID}_recover_concat.txt"
concat_path = AUDIO_DIR / f"{VIDEO_ID}_full.mp3"
concat_list.write_text("\n".join(f"file '{f.resolve()}'" for f in available) + "\n")
subprocess.run(["ffmpeg","-y","-f","concat","-safe","0","-i",str(concat_list),"-c","copy",str(concat_path)],
               check=True, capture_output=True)
print(f"[RECOVER] Audio merged: {concat_path.stat().st_size//1024} KB")

from engine.compositor import FFmpegCompositor
from engine.vault import VaultClip

comp = FFmpegCompositor()
dur  = comp.probe_audio_duration(concat_path)

from config import TTS_SPEED, VIDEO_SPEED
source_s = (dur / TTS_SPEED) * VIDEO_SPEED

# Probe total duration of kinetic sand to find a safe seek range
result = subprocess.run([
    FFPROBE, "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", str(KINETIC_SAND_PATH)
], capture_output=True, text=True, timeout=30)
total_s = float(result.stdout.strip())

# Force seek to AFTER 15 minutes (900s) and leave source_s + 300s at end
min_seek  = 900.0   # skip first 15 minutes entirely
safe_end  = total_s - source_s - 300.0
if safe_end < min_seek:
    safe_end = min_seek + 3600  # fallback

seek = random.uniform(min_seek, safe_end)
print(f"[RECOVER] Kinetic sand: {total_s/3600:.1f}hr  seek={seek/60:.1f}min  source_needed={source_s:.0f}s")

clip   = VaultClip(path=KINETIC_SAND_PATH, seek_start=seek, is_large=True)
output = comp.render(clip, concat_path, VIDEO_ID, title="My wife said she was sorely tempted to cheat on me with")

mb = output.stat().st_size / 1024 / 1024
probe = subprocess.run([FFPROBE,"-v","error","-show_entries","format=duration,size",
                        "-of","default=noprint_wrappers=1", str(output)], capture_output=True, text=True)
print(f"[RECOVER] ffprobe: {probe.stdout.strip()}")

if mb < 5:
    raise SystemExit(f"[RECOVER] ERROR: Too small ({mb:.1f} MB)")

print(f"\n[RECOVER] ✅ DONE: {output.name}  ({mb:.1f} MB)  seek was at {seek/60:.1f}min into kinetic sand")
