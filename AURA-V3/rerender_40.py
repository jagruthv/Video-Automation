"""
Re-render video 40 from existing audio, utilizing the newly fixed vault concat filter.
"""
import subprocess
from pathlib import Path
import shutil

VIDEO_ID = "5671636c3af6d1f7"
AUDIO_DIR = Path("tmp/audio")
CACHE_DIR = Path("tmp/vault_cache")

print("[RECOVER] Clearing corrupt concat cache...")
if CACHE_DIR.exists():
    shutil.rmtree(CACHE_DIR)

concat_path = AUDIO_DIR / f"{VIDEO_ID}_full.mp3"
if not concat_path.exists():
    raise SystemExit("[RECOVER] Audio missing.")

print(f"[RECOVER] Re-rendering video from {concat_path.name}")

from engine.vault import VaultManager
from engine.compositor import FFmpegCompositor

vault = VaultManager()
comp = FFmpegCompositor()

audio_dur = comp.probe_audio_duration(concat_path)
source_s = (audio_dur / comp.TTS_SPEED) * comp.VIDEO_SPEED

print(f"[RECOVER] Audio {audio_dur:.1f}s -> Need {source_s:.1f}s of video.")
clip = vault.pick_clip(needed_source_s=source_s)
print(f"[RECOVER] Selected clip: {clip.path.name} (is_large={clip.is_large})")

title = "My neighbor kept parking in my driveway, so I left town"
out = comp.render(clip, concat_path, VIDEO_ID, title=title)

print(f"[RECOVER] ✅ Done: {out.name} ({out.stat().st_size/1024/1024:.1f} MB)")
