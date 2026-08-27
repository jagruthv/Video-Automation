"""
engine/forges/caption_forge.py — AURA-V3 Caption Engine
=========================================================
Generates premium TikTok/Shorts-style burned-in captions for any video clip.

Approach:
  1. Split Audio_Narration into word groups (default: 5 words per group)
  2. Assign each group a time window proportional to word count
  3. Build an FFmpeg `drawtext` filter chain that burns each group onto
     the video at the correct timestamp
  4. Apply the filter via FFmpeg subprocess

Caption style:
  - Font    : Bold system font (arialbd.ttf fallback → built-in)
  - Size    : 78px (large, readable on phone screens)
  - Color   : White (#FFFFFF) with heavy black stroke (borderw=5)
  - Shadow  : Drop-shadow for depth
  - Position: Centered horizontally, 72% down vertically (above lower-third)
  - Case    : UPPERCASE (like TikTok / CapCut style)

No libass required — uses FFmpeg's built-in drawtext filter only.
"""

import logging
import re
import subprocess
from pathlib import Path

import config

logger = logging.getLogger("aura.forge.caption")

W   = config.OUTPUT_WIDTH    # 1080
H   = config.OUTPUT_HEIGHT   # 1920
FPS = config.OUTPUT_FPS      # 30

# Caption layout — Pro Editor Standard (CapCut/TikTok style)
_WORDS_PER_GROUP  = getattr(config, "CAPTION_WORDS_PER_GROUP", 3)   # 3 words = snappier pacing
_FONT_SIZE        = getattr(config, "CAPTION_FONT_SIZE", 82)        # slightly larger for impact
_FONT_COLOR_MAIN  = "white"          # all words: white with black stroke
_FONT_COLOR_HIGH  = "#FFE600"        # active word accent: bright yellow
_BORDER_COLOR     = "black"
_BORDER_W         = getattr(config, "CAPTION_BORDER_W", 6)          # thicker stroke = more punch
_SHADOW_X         = 4
_SHADOW_Y         = 4
_Y_POSITION       = int(H * 0.74)   # 74% down — above lower-third (CapCut default zone)


# ─────────────────────────────────────────────
# FONT RESOLUTION
# ─────────────────────────────────────────────

def _resolve_font() -> str:
    """
    Return the FFmpeg-safe font path string for drawtext.
    Tries in order:
      1. Custom bold font from config
      2. Windows Arial Bold
      3. Windows Arial regular
      4. Empty string (FFmpeg uses its own built-in default)

    FFmpeg drawtext font path on Windows MUST use forward slashes
    and escape the drive-letter colon as \\:
    """
    candidates = [
        config.UI_FONT_BOLD_PATH,
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for p in candidates:
        if p.exists():
            # Convert D:\path\to\font.ttf → D\\:/path/to/font.ttf
            posix = str(p).replace("\\", "/")
            if len(posix) >= 2 and posix[1] == ":":
                posix = posix[0] + "\\:" + posix[2:]
            logger.debug(f"[CAPTION] Using font: {p.name}")
            return posix

    logger.warning("[CAPTION] No TTF font found — FFmpeg will use its built-in default.")
    return ""


# ─────────────────────────────────────────────
# TEXT ESCAPING
# ─────────────────────────────────────────────

def _esc(text: str) -> str:
    """
    Escape text for FFmpeg drawtext `text=` value.
    Order matters: backslash must be escaped first.

    FFmpeg drawtext special chars:
      \\  →  \\\\
      '   →  \\'
      :   →  \\:
      %   →  %%
    """
    text = text.replace("\\", "\\\\")
    text = text.replace("'",  "\\'")
    text = text.replace(":",  "\\:")
    text = text.replace("%",  "%%")
    return text


# ─────────────────────────────────────────────
# WORD GROUPING + TIMING
# ─────────────────────────────────────────────

def _word_groups(narration: str, duration: float) -> list[tuple[str, float, float]]:
    """
    Split narration into timed caption groups.

    Returns:
        List of (text_group, start_sec, end_sec)
    """
    # Strip excess whitespace, normalize
    clean  = re.sub(r"\s+", " ", narration.strip())
    words  = clean.split()

    if not words:
        return []

    # Group into chunks of _WORDS_PER_GROUP
    groups: list[list[str]] = []
    for i in range(0, len(words), _WORDS_PER_GROUP):
        groups.append(words[i : i + _WORDS_PER_GROUP])

    n_groups = len(groups)
    result   = []

    # Time each group proportional to its word count
    total_words = len(words)
    elapsed     = 0.0
    for i, grp in enumerate(groups):
        grp_fraction = len(grp) / total_words
        grp_dur      = duration * grp_fraction
        start        = round(elapsed, 4)
        end          = round(elapsed + grp_dur, 4)
        # Give the last group the full remaining time
        if i == n_groups - 1:
            end = round(duration - 0.05, 4)
        result.append((" ".join(grp).upper(), start, end))
        elapsed += grp_dur

    logger.debug(
        f"[CAPTION] {total_words} words → {n_groups} groups "
        f"(~{_WORDS_PER_GROUP} words each) over {duration:.2f}s"
    )
    return result


# ─────────────────────────────────────────────
# DRAWTEXT FILTER CHAIN BUILDER
# ─────────────────────────────────────────────

def _build_drawtext_chain(groups: list[tuple[str, float, float]], font: str) -> str:
    """
    Build a comma-separated FFmpeg drawtext filter chain — Pro Editor style.

    Each caption card consists of two drawtext layers:
      Layer A: Full card text in WHITE with thick black stroke + drop shadow.
      Layer B: LAST WORD of the card in YELLOW overlaid on top, same position,
               creating the "active word" highlight effect used in CapCut, Reels, Shorts.

    This gives the appearance of word-level karaoke highlighting without ASS subtitles.
    """
    font_clause = f":fontfile='{font}'" if font else ""
    filters     = []

    for text, start, end in groups:
        escaped = _esc(text)
        words   = text.split()

        # ── Layer A: full card (white) ───────────────────────────────────────
        f_white = (
            f"drawtext="
            f"text='{escaped}'"
            f"{font_clause}"
            f":fontsize={_FONT_SIZE}"
            f":fontcolor={_FONT_COLOR_MAIN}"
            f":borderw={_BORDER_W}"
            f":bordercolor={_BORDER_COLOR}"
            f":shadowx={_SHADOW_X}"
            f":shadowy={_SHADOW_Y}"
            f":x=(w-text_w)/2"
            f":y={_Y_POSITION}"
            f":enable='between(t\\,{start}\\,{end})'"
        )
        filters.append(f_white)

        # ── Layer B: last word in yellow (highlight) ─────────────────────────
        # Estimate x offset for the last word by measuring its approximate pixel width
        # FFmpeg drawtext doesn't expose per-word metrics, so we use a proportional estimate:
        #   char_px ≈ font_size * 0.55 (bold uppercase aspect ratio)
        if len(words) > 1:
            last_word   = _esc(words[-1])
            other_words = _esc(" ".join(words[:-1]) + " ")
            # Approximate offset: width of all-but-last words + half-card centering
            # x = (w - total_text_w) / 2  +  prefix_text_w
            # We use text_w variable from the full card layer + prefix fraction
            char_w_est   = int(_FONT_SIZE * 0.56)   # estimated px per uppercase char
            prefix_chars = sum(len(w) + 1 for w in words[:-1])  # chars + space
            prefix_offset = prefix_chars * char_w_est
            # Full card width estimate
            total_chars  = len(text)
            total_w_est  = total_chars * char_w_est
            x_expr = f"(w-{total_w_est})/2+{prefix_offset}"

            f_yellow = (
                f"drawtext="
                f"text='{last_word}'"
                f"{font_clause}"
                f":fontsize={_FONT_SIZE}"
                f":fontcolor={_FONT_COLOR_HIGH}"
                f":borderw={_BORDER_W}"
                f":bordercolor={_BORDER_COLOR}"
                f":shadowx={_SHADOW_X}"
                f":shadowy={_SHADOW_Y}"
                f":x={x_expr}"
                f":y={_Y_POSITION}"
                f":enable='between(t\\,{start}\\,{end})'"
            )
            filters.append(f_yellow)

    return ",".join(filters)


# ─────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────

def burn(
    input_mp4: Path,
    narration : str,
    duration  : float,
    block_id  : int,
) -> Path:
    """
    Burn captions onto an existing video clip.

    Args:
        input_mp4 : The muxed segment (video + audio already merged).
        narration : The Audio_Narration text for this block.
        duration  : Total duration of the clip in seconds.
        block_id  : Used for output filename.

    Returns:
        Path to the caption-burned MP4 (replaces the segment in-place
        by writing to a sibling _cap.mp4 then returning it).
    """
    out_mp4 = config.TMP_RENDER_DIR / f"block_{block_id:03d}_captioned.mp4"

    if out_mp4.exists():
        logger.debug(f"[CAPTION] Block {block_id}: caption cache hit")
        return out_mp4

    groups = _word_groups(narration, duration)
    if not groups:
        logger.warning(f"[CAPTION] Block {block_id}: no words to caption — copying as-is")
        import shutil
        shutil.copy2(str(input_mp4), str(out_mp4))
        return out_mp4

    font   = _resolve_font()
    vf     = _build_drawtext_chain(groups, font)

    logger.info(
        f"[CAPTION] Block {block_id}: burning {len(groups)} caption groups "
        f"onto {input_mp4.name} ..."
    )

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-i",      str(input_mp4),
                "-vf",     vf,
                "-c:v",    config.VIDEO_CODEC,
                "-preset", config.PRESET,
                "-crf",    str(config.CRF),
                "-c:a",    "copy",            # audio passthrough — no re-encode
                "-r",      str(FPS),
                "-pix_fmt", "yuv420p",
                str(out_mp4),
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )

        if result.returncode != 0:
            logger.error(
                f"[CAPTION] Block {block_id}: FFmpeg drawtext FAILED "
                f"(exit {result.returncode}):\n"
                f"  STDERR: {result.stderr.strip()[-2000:]}\n"
                f"  FILTER: {vf[:300]}..."
            )
            # Fallback: return the uncaptioned segment
            import shutil
            shutil.copy2(str(input_mp4), str(out_mp4))
            logger.warning(f"[CAPTION] Block {block_id}: falling back to no-caption version")
            return out_mp4

        logger.info(f"[CAPTION] Block {block_id}: captions burned → {out_mp4.name}")
        return out_mp4

    except subprocess.TimeoutExpired:
        logger.error(
            f"[CAPTION] Block {block_id}: FFmpeg timed out after 180s. "
            f"This usually means the drawtext filter chain is malformed."
        )
        import shutil
        shutil.copy2(str(input_mp4), str(out_mp4))
        return out_mp4
