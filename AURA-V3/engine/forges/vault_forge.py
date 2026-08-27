"""
engine/forges/vault_forge.py -- AURA-V3 Background Vault Forge
===============================================================
Produces a dynamic multi-cut visual track from vault clips.

Rules (matching the user's spec):
  - MAX 1.5 seconds per cut — never a single long clip
  - Each cut picks a DIFFERENT random vault clip
  - Effects rotate: slow_zoom, pan_left, pan_right, fade_in, static
  - If vault is empty -> kinetic sand fallback (also multi-cut)
  - If kinetic sand missing -> black frame

Output: one concatenated MP4 sized to block duration.
"""

import logging
import math
import random
import subprocess
import traceback
from pathlib import Path

import config

logger = logging.getLogger("aura.forge.vault")

CUT_MAX_S   = 1.5    # hard cap per cut
EFFECTS     = ["slow_zoom", "pan_left", "pan_right", "fade_in", "static"]
EXTENSIONS  = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

W   = config.OUTPUT_WIDTH    # 1080
H   = config.OUTPUT_HEIGHT   # 1920
FPS = config.OUTPUT_FPS      # 30


# -----------------------------------------------------------------------
# VAULT CLIP POOL
# -----------------------------------------------------------------------

def _all_clips() -> list[Path]:
    """Return all usable clips from the vault directory."""
    if not config.VAULT_DIR.exists():
        return []
    return [
        f for f in config.VAULT_DIR.iterdir()
        if f.suffix.lower() in EXTENSIONS and f.stat().st_size > 10_000
    ]


def _pick_clips(n: int) -> list[Path]:
    """
    Pick n different clips from the vault.
    If vault has fewer than n clips, re-use with shuffle.
    Falls back to kinetic sand or None.
    """
    pool = _all_clips()
    if pool:
        if len(pool) >= n:
            return random.sample(pool, n)
        # Not enough unique clips: shuffle and repeat
        result = []
        while len(result) < n:
            random.shuffle(pool)
            result.extend(pool)
        return result[:n]

    # Kinetic sand fallback
    ks = config.KINETIC_SAND_PATH
    if ks.exists():
        logger.warning(f"[VAULT] Vault empty -- using kinetic sand for all {n} cuts")
        return [ks] * n

    logger.warning("[VAULT] No vault clips AND no kinetic sand -- black frame fallback")
    return []


# -----------------------------------------------------------------------
# EFFECT FILTERS
# -----------------------------------------------------------------------

def _vf_slow_zoom(duration: float) -> str:
    frames = max(1, int(duration * FPS))
    return (
        f"scale=4000:-1,"
        f"zoompan=z='min(zoom+0.0005,1.3)'"
        f":x='iw/2-(iw/zoom/2)'"
        f":y='ih/2-(ih/zoom/2)'"
        f":d={frames}:fps={FPS},"
        f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,"
        f"format=yuv420p,setpts=N/FRAME_RATE/TB"
    )


def _vf_pan_left(duration: float) -> str:
    frames = max(1, int(duration * FPS))
    return (
        f"scale=4000:-1,"
        f"zoompan=z='1.3'"
        f":x='iw/2-(iw/zoom/2)+((iw*0.3)*(on/{frames}))'"
        f":y='ih/2-(ih/zoom/2)'"
        f":d={frames}:fps={FPS},"
        f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,"
        f"format=yuv420p,setpts=N/FRAME_RATE/TB"
    )


def _vf_pan_right(duration: float) -> str:
    frames = max(1, int(duration * FPS))
    return (
        f"scale=4000:-1,"
        f"zoompan=z='1.3'"
        f":x='iw/2-(iw/zoom/2)-((iw*0.3)*(on/{frames}))'"
        f":y='ih/2-(ih/zoom/2)'"
        f":d={frames}:fps={FPS},"
        f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,"
        f"format=yuv420p,setpts=N/FRAME_RATE/TB"
    )


def _vf_fade_in(duration: float) -> str:
    fade_frames = min(int(FPS * 0.3), int(duration * FPS // 2))
    return (
        f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,"
        f"format=yuv420p,"
        f"fade=t=in:st=0:d={fade_frames/FPS:.2f},"
        f"setpts=N/FRAME_RATE/TB"
    )


def _vf_static() -> str:
    return (
        f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,"
        f"format=yuv420p,setpts=N/FRAME_RATE/TB"
    )


def _build_vf(effect: str, duration: float) -> str:
    if effect == "slow_zoom":  return _vf_slow_zoom(duration)
    if effect == "pan_left":   return _vf_pan_left(duration)
    if effect == "pan_right":  return _vf_pan_right(duration)
    if effect == "fade_in":    return _vf_fade_in(duration)
    return _vf_static()


# -----------------------------------------------------------------------
# SINGLE CUT RENDERER
# -----------------------------------------------------------------------

def _render_cut(clip: Path, cut_dur: float, cut_idx: int,
                block_id: int, effect: str) -> Path:
    """Render one 1.5s (or shorter) cut from a vault clip."""
    out = config.TMP_RENDER_DIR / f"block_{block_id:03d}_cut_{cut_idx:02d}.mp4"
    if out.exists() and out.stat().st_size > 5_000:
        logger.debug(f"[VAULT] Block {block_id} cut {cut_idx}: cache hit")
        return out

    vf = _build_vf(effect, cut_dur)

    # Random seek within the clip so we don't always start from 0
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(clip)],
            capture_output=True, text=True, timeout=10,
        )
        clip_dur = float(r.stdout.strip() or "0")
    except Exception:
        clip_dur = 0.0

    ss_args = []
    if clip_dur > cut_dur + 2:
        seek_max = clip_dur - cut_dur - 1
        seek_to  = random.uniform(0, seek_max)
        ss_args  = ["-ss", f"{seek_to:.2f}"]

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        *ss_args,
        "-stream_loop", "-1", "-i", str(clip),
        "-t", str(cut_dur),
        "-vf", vf,
        "-r", str(FPS),
        "-c:v", config.VIDEO_CODEC,
        "-preset", config.PRESET,
        "-crf", str(config.CRF),
        "-an",  # no audio -- assembly stage muxes audio separately
        str(out),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0 or not out.exists():
        logger.error(
            f"[VAULT] Block {block_id} cut {cut_idx} FAILED "
            f"(exit {result.returncode}):\n{result.stderr.strip()[-1000:]}"
        )
        raise RuntimeError(f"vault cut {cut_idx} failed for block {block_id}")

    logger.debug(
        f"[VAULT] Block {block_id} cut {cut_idx}: "
        f"{effect} {cut_dur:.2f}s -> {out.name}"
    )
    return out


# -----------------------------------------------------------------------
# BLACK FRAME FALLBACK
# -----------------------------------------------------------------------

def _render_black(block_id: int, duration: float) -> Path:
    out = config.TMP_RENDER_DIR / f"block_{block_id:03d}_vault.mp4"
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi",
        "-i", f"color=black:s={W}x{H}:r={FPS}:d={duration}",
        "-c:v", config.VIDEO_CODEC, "-preset", config.PRESET,
        "-crf", str(config.CRF), "-an",
        str(out),
    ]
    subprocess.run(cmd, capture_output=True, timeout=30)
    return out


# -----------------------------------------------------------------------
# CONCAT CUTS
# -----------------------------------------------------------------------

def _concat_cuts(cut_paths: list[Path], block_id: int) -> Path:
    out     = config.TMP_RENDER_DIR / f"block_{block_id:03d}_vault.mp4"
    lst     = config.TMP_RENDER_DIR / f"block_{block_id:03d}_cuts.txt"
    lines   = [f"file '{p.as_posix()}'" for p in cut_paths]
    lst.write_text("\n".join(lines) + "\n", encoding="utf-8")

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "concat", "-safe", "0", "-i", str(lst),
        "-vf", f"setpts=N/FRAME_RATE/TB",
        "-c:v", config.VIDEO_CODEC,
        "-preset", config.PRESET,
        "-crf", str(config.CRF),
        "-r", str(FPS),
        "-pix_fmt", "yuv420p",
        "-an",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    lst.unlink(missing_ok=True)

    if result.returncode != 0:
        logger.error(
            f"[VAULT] Block {block_id}: concat FAILED:\n"
            f"{result.stderr.strip()[-1000:]}"
        )
        raise RuntimeError(f"vault concat failed for block {block_id}")

    return out


# -----------------------------------------------------------------------
# PUBLIC API
# -----------------------------------------------------------------------

def render(params, block_id: int, duration: float) -> Path:
    """
    Render a multi-cut vault background track for one block.

    Args:
        params:   BackgroundVaultParams (effect field used as default effect)
        block_id: Block number
        duration: Audio duration in seconds (determines total clip length)

    Returns:
        Path to the final concatenated MP4 (no audio, correct length)
    """
    out_final = config.TMP_RENDER_DIR / f"block_{block_id:03d}_vault.mp4"
    if out_final.exists() and out_final.stat().st_size > 10_000:
        logger.info(f"[VAULT] Block {block_id}: cache hit -> {out_final.name}")
        return out_final

    # How many cuts?
    n_cuts   = max(1, math.ceil(duration / CUT_MAX_S))
    cut_dur  = duration / n_cuts  # exact even split

    logger.info(
        f"[VAULT] Block {block_id}: {duration:.2f}s -> "
        f"{n_cuts} cuts x {cut_dur:.2f}s each"
    )

    # Pick clips
    clips = _pick_clips(n_cuts)
    if not clips:
        logger.warning(f"[VAULT] Block {block_id}: no clips available, using black frame")
        return _render_black(block_id, duration)

    # Build rotating effect list
    base_effect = getattr(params, "effect", "slow_zoom") if params else "slow_zoom"
    effect_pool = EFFECTS if base_effect == "random" else (
        [base_effect] + [e for e in EFFECTS if e != base_effect]
    )

    # Render each cut
    cut_paths = []
    for i, clip in enumerate(clips):
        effect = effect_pool[i % len(effect_pool)]
        try:
            cut = _render_cut(clip, cut_dur, i, block_id, effect)
            cut_paths.append(cut)
        except Exception as exc:
            logger.warning(
                f"[VAULT] Block {block_id} cut {i} failed ({exc}), "
                f"trying black frame cut..."
            )
            blk = _render_black_cut(cut_dur, i, block_id)
            cut_paths.append(blk)

    if len(cut_paths) == 1:
        # Single cut: just rename/move
        cut_paths[0].replace(out_final)
        logger.info(f"[VAULT] Block {block_id}: single cut -> {out_final.name}")
        return out_final

    # Concatenate all cuts
    out = _concat_cuts(cut_paths, block_id)

    # Clean up individual cut files
    for p in cut_paths:
        p.unlink(missing_ok=True)

    logger.info(
        f"[VAULT] Block {block_id}: {n_cuts} cuts concatenated -> "
        f"{out.name} ({out.stat().st_size // 1024} KB)"
    )
    return out


def _render_black_cut(duration: float, cut_idx: int, block_id: int) -> Path:
    """Render a black frame cut as fallback for a single failed cut."""
    out = config.TMP_RENDER_DIR / f"block_{block_id:03d}_blackcut_{cut_idx:02d}.mp4"
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi",
        "-i", f"color=black:s={W}x{H}:r={FPS}:d={duration:.3f}",
        "-c:v", config.VIDEO_CODEC, "-preset", config.PRESET,
        "-crf", str(config.CRF), "-an",
        str(out),
    ]
    subprocess.run(cmd, capture_output=True, timeout=15)
    return out
