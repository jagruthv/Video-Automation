"""
AURA-V2 Pinterest Vault AI Text Scanner (EasyOCR)
=================================================
Extracts frames and uses a deep learning AI model (EasyOCR) 
to detect watermarks, TikTok logos, or overlay text embedded in video pixels.
"""

import os
import sys
import subprocess
import tempfile
from pathlib import Path

# Fix Windows unicode printing
sys.stdout.reconfigure(encoding='utf-8')

try:
    import easyocr
except ImportError:
    print("[SCANNER] ❌ Missing EasyOCR. Run: pip install easyocr")
    sys.exit(1)

# ─── CONFIG ───────────────────────────────────────────────────────────────────
VAULT_DIR      = Path(r"D:\Automation\n8n\asmr-qa-vault\public\accepted_vault")
FRAMES_PER_VID = 5          # Sample 5 frames across the video
MIN_CONFIDENCE = 0.25       # AI confidence threshold (0.0 to 1.0)
DRY_RUN        = False      # Change to True to test without deleting
# ──────────────────────────────────────────────────────────────────────────────

print("🤖 Initializing AI Text Detection Model (this takes a few seconds)...")
# Initialize reader for English. gpu=True if CUDA is available, otherwise falls back to CPU.
reader = easyocr.Reader(['en'], gpu=True)


def get_video_duration(path: str) -> float:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=10
        )
        return float(result.stdout.strip() or 0)
    except Exception:
        return 0.0


def extract_frames(video_path: str, timestamps: list[float], tmp_dir: str) -> list[str]:
    frame_paths = []
    for i, ts in enumerate(timestamps):
        out_path = os.path.join(tmp_dir, f"frame_{i:02d}.jpg")
        # Extract at low quality (-q:v 5) to save CPU since the AI is very robust
        cmd = ["ffmpeg", "-y", "-ss", f"{ts:.2f}", "-i", str(video_path),
               "-vframes", "1", "-q:v", "5", out_path]
        subprocess.run(cmd, capture_output=True, timeout=15)
        if os.path.exists(out_path):
            frame_paths.append(out_path)
    return frame_paths


def scan_video(video_path: Path) -> tuple[bool, str]:
    duration = get_video_duration(str(video_path))
    if duration <= 0:
        return False, ""

    # Sample evenly across the video
    fractions = [i/(FRAMES_PER_VID+1) for i in range(1, FRAMES_PER_VID+1)]
    timestamps = [min(duration * f, duration - 1.0) for f in fractions]

    with tempfile.TemporaryDirectory() as tmp_dir:
        frame_paths = extract_frames(str(video_path), timestamps, tmp_dir)

        text_found = []
        for frame_path in frame_paths:
            # detail=1 returns bounding boxes, text, and confidence
            results = reader.readtext(frame_path, detail=1)
            
            for (bbox, text, conf) in results:
                text = text.strip().lower()
                # If confidence is okay, and it's not a tiny random speck
                if conf >= MIN_CONFIDENCE and len(text) >= 2:
                    # Ignore pure noise like "||" or ".."
                    if len(set(text.replace(" ", ""))) > 1:
                        text_found.append(f"'{text}'(conf:{conf:.2f})")

            # Early exit if we already found strong text in this video
            if len(text_found) >= 2 or any('tiktok' in t for t in text_found):
                return True, " | ".join(text_found[:3])

        if text_found:
            return True, " | ".join(text_found[:3])

    return False, ""


def main():
    if not VAULT_DIR.exists():
        print(f"[SCANNER] ❌ Vault not found: {VAULT_DIR}")
        sys.exit(1)

    videos = sorted(VAULT_DIR.glob("*.mp4"))
    total = len(videos)
    print(f"\n{'='*60}")
    print(f"  AURA-V2 Vault AI Text Scanner (EasyOCR)")
    print(f"  Vault : {VAULT_DIR}")
    print(f"  Total : {total} videos  |  Deletions Enabled: {not DRY_RUN}")
    print(f"{'='*60}\n")

    flagged, clean = [], []

    for i, video in enumerate(videos, 1):
        sys.stdout.write(f"\r[{i:>3}/{total}] AI Scanning: {video.name[:45]:<45}")
        sys.stdout.flush()

        has_text, snippet = scan_video(video)

        if has_text:
            flagged.append((video.name, snippet))
            sys.stdout.write(f"\r[{i:>3}/{total}] 🔴 OVERLAY TEXT DETECTED: {snippet[:60]:<60}\n")
            if not DRY_RUN:
                try:
                    video.unlink()
                except Exception as e:
                    print(f"     └─ Failed to delete: {e}")
        else:
            clean.append(video.name)

    print(f"\n\n{'='*60}")
    print(f"  ✅ Clean Passed  : {len(clean)}")
    print(f"  🔴 Text Flagged  : {len(flagged)}  {'(DELETED from disk)' if not DRY_RUN else ''}")
    print(f"{'='*60}\n")

    if flagged:
        print("Detailed Log of Deleted Files:")
        for name, snippet in flagged:
            print(f" • {name} -> {snippet}")
    print()


if __name__ == "__main__":
    main()
