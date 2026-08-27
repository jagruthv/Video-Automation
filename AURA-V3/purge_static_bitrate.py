"""
Scan all vault clips and delete ones with suspiciously low bitrate
(near-static / freeze-frame videos look like a real video but compress
to near-nothing because there is barely any motion between frames).

Threshold: bitrate < 50 kbps  => almost certainly a still/freeze image.

After purging, clears the concat cache and re-renders video 39.
Run: python purge_static_bitrate.py
"""
import subprocess, json, shutil
from pathlib import Path

VAULT_DIR  = Path(r"d:\Automation\n8n\asmr-qa-vault\public\accepted_vault")
CACHE_DIR  = Path("tmp/vault_cache")
FFPROBE    = "ffprobe"
MIN_KBPS   = 50       # Below this => treat as static/frozen

print(f"\n[PURGE] Scanning {VAULT_DIR} for near-static clips (bitrate < {MIN_KBPS} kbps)...")
clips = [
    f for f in VAULT_DIR.rglob("*")
    if f.suffix.lower() in {".mp4", ".mov", ".mkv"} and f.is_file()
]
print(f"[PURGE] {len(clips)} clips found.\n")

deleted = []
kept    = 0

for clip in sorted(clips):
    try:
        result = subprocess.run([
            FFPROBE, "-v", "quiet", "-print_format", "json",
            "-show_format", str(clip)
        ], capture_output=True, text=True, timeout=10)
        data = json.loads(result.stdout)
        fmt  = data.get("format", {})

        duration = float(fmt.get("duration", 0))
        size_b   = int(fmt.get("size", 0))
        if duration <= 0:
            kbps = 0
        else:
            kbps = (size_b * 8) / duration / 1000   # kilobits per second

        if kbps < MIN_KBPS:
            print(f"  [DELETE] {clip.name} — {kbps:.1f} kbps  dur={duration:.1f}s  size={size_b//1024}KB")
            clip.unlink(missing_ok=True)
            deleted.append(clip.name)
        else:
            kept += 1

    except Exception as e:
        print(f"  [SKIP]   {clip.name} — {e}")

print(f"\n[PURGE] Deleted {len(deleted)} near-static clips. Kept {kept} valid clips.")

# Clear concat cache
if CACHE_DIR.exists():
    shutil.rmtree(CACHE_DIR)
    print(f"[PURGE] Cleared concat cache.")

if not deleted:
    print("[PURGE] No clips deleted — bitrate threshold not met by any clip.")
    print("[PURGE] Listing top-10 LOWEST bitrate clips for manual inspection:")
    all_kbps = []
    for clip in clips:
        try:
            r = subprocess.run([FFPROBE, "-v", "quiet", "-print_format", "json", "-show_format", str(clip)],
                               capture_output=True, text=True, timeout=10)
            f = json.loads(r.stdout).get("format", {})
            d = float(f.get("duration", 0))
            s = int(f.get("size", 0))
            kbps = (s * 8) / d / 1000 if d > 0 else 0
            all_kbps.append((kbps, d, clip))
        except Exception:
            pass
    for kbps, dur, clip in sorted(all_kbps)[:10]:
        print(f"  {kbps:.1f} kbps  dur={dur:.1f}s  {clip.name}")
    raise SystemExit("[PURGE] Please review the clips above and re-run with a higher MIN_KBPS if needed.")

# Re-render video 39
print("\n[RECOVER] Re-rendering video 39 from audio chunks...\n")
VIDEO_ID  = "337f2fd96fd41c3b"
AUDIO_DIR = Path("tmp/audio")

available = [AUDIO_DIR / f"{VIDEO_ID}_{x}.mp3" for x in ["c1","p2","p3"]]
available = [f for f in available if f.exists()]
if not available:
    raise SystemExit("[RECOVER] No audio chunks found!")

concat_list = AUDIO_DIR / f"{VIDEO_ID}_recover_concat.txt"
concat_path = AUDIO_DIR / f"{VIDEO_ID}_full.mp3"
concat_list.write_text("\n".join(f"file '{f.resolve()}'" for f in available) + "\n")

subprocess.run(["ffmpeg","-y","-f","concat","-safe","0","-i",str(concat_list),"-c","copy",str(concat_path)],
               check=True, capture_output=True)
print(f"[RECOVER] Audio merged: {concat_path.stat().st_size//1024} KB")

from engine.vault import VaultManager
from engine.compositor import FFmpegCompositor

vault  = VaultManager()
comp   = FFmpegCompositor()
dur    = comp.probe_audio_duration(concat_path)
source = (dur / comp.TTS_SPEED) * comp.VIDEO_SPEED
clip   = vault.pick_clip(needed_source_s=source)

print(f"[RECOVER] Source: {dur:.1f}s audio  need {source:.1f}s video")
print(f"[RECOVER] Clip: {clip.path.name}  is_large={clip.is_large}  seek={clip.seek_start:.0f}s")

out = comp.render(clip, concat_path, VIDEO_ID, title="My wife said she was sorely tempted to cheat on me with")
mb  = out.stat().st_size / 1024 / 1024

# Validate
probe = subprocess.run([FFPROBE,"-v","error","-show_entries","format=duration,size",
                        "-of","default=noprint_wrappers=1", str(out)],
                       capture_output=True, text=True)
print(f"[RECOVER] ffprobe: {probe.stdout.strip()}")

if mb < 5:
    raise SystemExit(f"[RECOVER] ERROR: Output too small ({mb:.1f} MB)!")

print(f"\n[RECOVER] ✅ SUCCESS: {out.name}  ({mb:.1f} MB)")
