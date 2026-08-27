"""
Quick recovery: re-composite video 337f2fd9 from existing audio chunks.
Run once: python recover_video.py
"""
import subprocess
from pathlib import Path

VIDEO_ID   = "337f2fd96fd41c3b"
AUDIO_DIR  = Path("tmp/audio")
RENDER_DIR = Path("tmp/renders")
OUTPUT_DIR = Path("output")

# ── Step 1: Verify chunks exist ─────────────────────────────────────────────
c1 = AUDIO_DIR / f"{VIDEO_ID}_c1.mp3"
p2 = AUDIO_DIR / f"{VIDEO_ID}_p2.mp3"
p3 = AUDIO_DIR / f"{VIDEO_ID}_p3.mp3"

available = [f for f in [c1, p2, p3] if f.exists()]
print(f"[RECOVER] Found {len(available)} audio chunks: {[f.name for f in available]}")
if not available:
    raise SystemExit("No audio chunks found — cannot recover.")

# Build concat list from whichever parts exist
concat_list = AUDIO_DIR / f"{VIDEO_ID}_recover_concat.txt"
concat_path = AUDIO_DIR / f"{VIDEO_ID}_full.mp3"

with open(concat_list, "w") as f:
    for chunk in available:
        f.write(f"file '{chunk.resolve()}'\n")

print(f"[RECOVER] Concatenating {len(available)} chunks -> {concat_path.name}")
subprocess.run([
    "ffmpeg", "-y", "-f", "concat", "-safe", "0",
    "-i", str(concat_list), "-c", "copy", str(concat_path)
], check=True, capture_output=True)
print(f"[RECOVER] Audio merged OK ({concat_path.stat().st_size / 1024:.0f} KB)")

# ── Step 2: Pick a clip and re-render ───────────────────────────────────────
from engine.vault import VaultManager
from engine.compositor import FFmpegCompositor

vault   = VaultManager()
comp    = FFmpegCompositor()

audio_dur = comp.probe_audio_duration(concat_path)
source_s  = (audio_dur / comp.TTS_SPEED) * comp.VIDEO_SPEED
clip      = vault.pick_clip(needed_source_s=source_s)

print(f"[RECOVER] Audio duration: {audio_dur:.1f}s -> source needed: {source_s:.1f}s")
print(f"[RECOVER] Selected clip: {clip.path.name} (seek={clip.seek_start:.0f}s)")

# Delete corrupted file first
title = "My wife said she was sorely tempted to cheat on me with"
out = comp.render(clip, concat_path, VIDEO_ID, title=title)
print(f"[RECOVER] ✅ Re-rendered: {out.name} ({out.stat().st_size/1024/1024:.1f} MB)")

# ── Step 3: Update AURA-V2 file_path with the clean output ─────────────────
import json, urllib.request
payload = json.dumps({"id": 39, "file_path": str(out).replace("\\", "/")}).encode()
req = urllib.request.Request(
    "http://localhost:3001/api/db/update-path",
    data=payload, headers={"Content-Type": "application/json"}
)
try:
    with urllib.request.urlopen(req, timeout=5) as r:
        print(f"[RECOVER] V2 path updated: {r.read()}")
except Exception as e:
    print(f"[RECOVER] Could not auto-update V2 path ({e}) — update manually if needed.")
    print(f"[RECOVER] New path: {out}")
