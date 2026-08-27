"""
engine/forges/assembly.py — AURA-V3 FFmpeg Assembly Dictator
=============================================================
Takes all per-block (visual_clip, audio_clip, narration_text) tuples
and assembles the final premium 1080×1920 30fps MP4.

Per-block pipeline:
  1. Mux: overlay audio onto the silent visual clip.
  2. Normalize: force 1080×1920, 30fps, yuv420p, clean PTS timestamps.
  3. Caption: burn TikTok-style captions via caption_forge.
  4. Concat all captioned segments via -f concat demuxer.
  5. Final PTS reset to prevent timestamp-corruption bugs.

Every subprocess call is logged with:
  - Full FFmpeg command (in DEBUG log)
  - Exit code, stderr tail on failure
  - Duration of each segment before and after processing
  - Final video filesize and total duration
"""

import logging
import shutil
import subprocess
import traceback
from pathlib import Path

import config
from engine.forges.caption_forge import burn as burn_captions

logger = logging.getLogger("aura.forge.assembly")

W   = config.OUTPUT_WIDTH    # 1080
H   = config.OUTPUT_HEIGHT   # 1920
FPS = config.OUTPUT_FPS      # 30


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def _probe_duration(path: Path) -> float:
    """Return media duration in seconds via ffprobe."""
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
        return float(raw)
    except Exception as exc:
        logger.error(
            f"[ASSEM] ffprobe failed for '{path.name}': {exc}\n"
            f"  Check that FFmpeg/ffprobe is on PATH and the file is not corrupt.",
            exc_info=True,
        )
        return 0.0


def _run_ffmpeg(cmd: list[str], label: str, timeout: int = 180) -> None:
    """
    Run an FFmpeg command, log the full command at DEBUG level,
    and raise RuntimeError with the full stderr on failure.
    """
    logger.debug(f"[ASSEM] {label}: running:\n  {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

    if result.returncode != 0:
        stderr_tail = result.stderr.strip()[-3000:]
        logger.error(
            f"[ASSEM] {label}: FFmpeg FAILED (exit {result.returncode}).\n"
            f"  Command: {' '.join(cmd[:8])} ...\n"
            f"  STDERR (last 3000 chars):\n{stderr_tail}"
        )
        raise RuntimeError(
            f"FFmpeg failed in step '{label}'. "
            f"Exit code: {result.returncode}. "
            f"See log for full STDERR."
        )

    logger.debug(f"[ASSEM] {label}: FFmpeg exited 0 OK")


# ─────────────────────────────────────────────
# PER-BLOCK SEGMENT NORMALIZER
# ─────────────────────────────────────────────

def _normalize(visual: Path, audio: Path, block_id: int) -> Path:
    """
    Mux audio + visual, normalize to 1080×1920 30fps yuv420p.
    Loops visual if shorter than audio; trims if longer.

    FFmpeg argument order:
      -stream_loop -1   MUST be BEFORE -i (input option, not output option)
      -t <duration>     placed AFTER all -i args (output option)
    """
    out = config.TMP_RENDER_DIR / f"block_{block_id:03d}_segment.mp4"
    if out.exists():
        logger.debug(f"[ASSEM] Block {block_id}: mux/normalize cache hit ({out.name})")
        return out

    audio_dur  = _probe_duration(audio)
    visual_dur = _probe_duration(visual)

    logger.info(
        f"[ASSEM] Block {block_id}: normalizing — "
        f"visual={visual_dur:.2f}s, audio={audio_dur:.2f}s"
    )

    if audio_dur <= 0:
        raise RuntimeError(
            f"[ASSEM] Block {block_id}: audio duration is 0 or invalid. "
            f"Audio file: {audio} ({audio.stat().st_size} bytes). "
            f"Delete the audio cache and re-run."
        )

    if visual_dur <= 0:
        raise RuntimeError(
            f"[ASSEM] Block {block_id}: visual duration is 0 or invalid. "
            f"Visual file: {visual} ({visual.stat().st_size} bytes). "
            f"Delete the visual cache and re-run."
        )

    # Build input args — loop visual if it is shorter than audio
    if visual_dur < audio_dur:
        logger.info(
            f"[ASSEM] Block {block_id}: visual ({visual_dur:.2f}s) < audio ({audio_dur:.2f}s) "
            f"— applying stream_loop"
        )
        visual_input = ["-stream_loop", "-1", "-i", str(visual)]
    else:
        visual_input = ["-i", str(visual)]

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        *visual_input,
        "-i", str(audio),
        "-t", str(audio_dur),   # output duration = audio length
        "-vf", (
            f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,"
            f"format=yuv420p,"
            f"fps={FPS},"
            f"setpts=N/FRAME_RATE/TB"    # absolute PTS reset
        ),
        "-af", "asetpts=PTS-STARTPTS",
        "-c:v",   config.VIDEO_CODEC,
        "-preset", config.PRESET,
        "-crf",   str(config.CRF),
        "-c:a",   config.AUDIO_CODEC,
        "-b:a",   config.AUDIO_BITRATE,
        "-movflags", "+faststart",
        str(out),
    ]

    _run_ffmpeg(cmd, f"normalize block {block_id}", timeout=180)

    seg_dur = _probe_duration(out)
    logger.info(
        f"[ASSEM] Block {block_id}: segment muxed — "
        f"{seg_dur:.2f}s, "
        f"{out.stat().st_size / 1024:.0f} KB → {out.name}"
    )
    return out


# ─────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────

def assemble(
    block_segments: dict[int, tuple[Path, Path, str]],
    title: str,
) -> Path:
    """
    Normalize, caption, and concatenate all blocks into the final output video.

    Args:
        block_segments: {Block_ID: (visual_mp4, audio_mp3, narration_text)}
                        Keys must be in ascending order (1, 2, 3, ...).
        title:          Used to build the safe output filename.

    Returns:
        Path to the final captioned MP4 in config.OUTPUT_DIR.
    """
    if not block_segments:
        raise ValueError("[ASSEM] block_segments is empty — nothing to assemble.")

    logger.info(
        f"[ASSEM] Starting assembly: {len(block_segments)} blocks, "
        f"title='{title}'"
    )

    captioned_segments: list[Path] = []

    # ── Step 1: Normalize + Caption each block ─────────────────────────────
    for block_id in sorted(block_segments.keys()):
        visual, audio, narration = block_segments[block_id]
        logger.info(
            f"[ASSEM] ── Block {block_id}/{len(block_segments)} ──"
        )

        try:
            # Mux audio onto visual, normalize to spec
            muxed = _normalize(visual, audio, block_id)

            # Burn captions onto the muxed segment
            audio_dur = _probe_duration(audio)
            captioned = burn_captions(muxed, narration, audio_dur, block_id)

            captioned_segments.append(captioned)

        except Exception as exc:
            logger.critical(
                f"[ASSEM] Block {block_id} FAILED — cannot continue assembly.\n"
                f"  Visual: {visual}\n"
                f"  Audio:  {audio}\n"
                f"  Error:  {exc}\n"
                f"  Traceback:\n{traceback.format_exc()}"
            )
            raise

    logger.info(f"[ASSEM] All {len(captioned_segments)} segments ready. Building concat list ...")

    # ── Step 2: Write concat list ──────────────────────────────────────────
    concat_txt = config.TMP_RENDER_DIR / "final_concat.txt"
    lines      = [f"file '{p.as_posix()}'" for p in captioned_segments]
    concat_txt.write_text("\n".join(lines) + "\n", encoding="utf-8")
    logger.debug(f"[ASSEM] Concat list:\n" + "\n".join(lines))

    # ── Step 3: Concat + final PTS reset ──────────────────────────────────
    safe_title = "".join(
        c for c in title if c.isalnum() or c in " _-"
    )[:60].strip().replace(" ", "_")

    out_mp4 = config.OUTPUT_DIR / f"{safe_title}.mp4"

    logger.info(f"[ASSEM] Concatenating → {out_mp4.name} ...")

    concat_cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_txt),
        # Global PTS reset — eliminates "400,000-hour video" corruption bug
        "-vf", "setpts=N/FRAME_RATE/TB",
        "-af", "asetpts=PTS-STARTPTS",
        "-c:v",   config.VIDEO_CODEC,
        "-preset", config.PRESET,
        "-crf",   str(config.CRF),
        "-c:a",   config.AUDIO_CODEC,
        "-b:a",   config.AUDIO_BITRATE,
        "-r",     str(FPS),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_mp4),
    ]

    _run_ffmpeg(concat_cmd, "final concat", timeout=300)

    # ── Step 4: Final quality report ──────────────────────────────────────
    size_mb   = out_mp4.stat().st_size / 1_048_576
    final_dur = _probe_duration(out_mp4)

    logger.info(
        f"[ASSEM] ============================================\n"
        f"  FINAL VIDEO READY\n"
        f"  Path     : {out_mp4}\n"
        f"  Duration : {final_dur:.1f}s  ({final_dur/60:.1f} min)\n"
        f"  File size: {size_mb:.1f} MB\n"
        f"  Segments : {len(captioned_segments)}\n"
        f"  Codec    : {config.VIDEO_CODEC} CRF={config.CRF}\n"
        f"============================================"
    )

    return out_mp4
