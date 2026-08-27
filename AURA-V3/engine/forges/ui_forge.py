"""
engine/forges/ui_forge.py — AURA-V3 UI Forge
=============================================
Renders a Pillow PNG of an iPhone SMS or email notification banner,
then animates it with FFmpeg (slide-in from top + hold + fade out).

Supported popup_type values:
  "sms"   → iOS-style green message bubble with sender + body
  "email" → Email notification card with app label, sender, body preview

Output: silent MP4 at 1080×1920 30fps, exactly `duration` seconds long.

Windows-safe: FFmpeg filter_complex expressions use double-quoted strings
internally to avoid cmd.exe and Python quoting conflicts.
"""

import logging
import subprocess
from pathlib import Path
from textwrap import wrap

import config
from models import UIPopupParams

logger = logging.getLogger("aura.forge.ui")

W   = config.OUTPUT_WIDTH    # 1080
H   = config.OUTPUT_HEIGHT   # 1920
FPS = config.OUTPUT_FPS      # 30

# ── Color palette ──────────────────────────────────────────────────────────
_BG          = (13, 13, 26)
_BUBBLE_SMS  = (37, 211, 102)   # iMessage green
_BUBBLE_EM   = (30, 80, 160)    # email blue
_TEXT_DARK   = (20, 20, 20)
_TEXT_LIGHT  = (240, 240, 240)
_PANEL_BG    = (22, 22, 35)
_PANEL_STROKE= (60, 60, 80)


# ─────────────────────────────────────────────
# FONT LOADER
# ─────────────────────────────────────────────

def _font(path: Path, size: int):
    """Load TTF font; fall back to Pillow's built-in if TTF is missing."""
    from PIL import ImageFont
    try:
        return ImageFont.truetype(str(path), size)
    except Exception:
        logger.warning(f"[UI] Font not found at {path}. Using Pillow default.")
        return ImageFont.load_default()


# ─────────────────────────────────────────────
# ROUNDED RECT HELPER
# ─────────────────────────────────────────────

def _rrect(draw, x1: int, y1: int, x2: int, y2: int,
           radius: int, fill, outline=None, width: int = 1) -> None:
    """Draw a rounded rectangle using Pillow's native method."""
    draw.rounded_rectangle(
        [x1, y1, x2, y2],
        radius=radius,
        fill=fill,
        outline=outline,
        width=width,
    )


# ─────────────────────────────────────────────
# PNG RENDERERS
# ─────────────────────────────────────────────

def _sms_png(params: UIPopupParams, out: Path) -> None:
    """Draw an iPhone-style SMS notification card."""
    from PIL import Image, ImageDraw

    img  = Image.new("RGB", (W, H), _BG)
    draw = ImageDraw.Draw(img)

    # Panel
    px1, py1 = 40, 200
    px2, py2 = W - 40, 720
    _rrect(draw, px1, py1, px2, py2, radius=38, fill=_PANEL_BG,
           outline=_PANEL_STROKE, width=2)

    # App label + timestamp
    f_app  = _font(config.UI_FONT_PATH, 30)
    f_name = _font(config.UI_FONT_BOLD_PATH, 42)
    f_body = _font(config.UI_FONT_PATH, 36)
    f_time = _font(config.UI_FONT_PATH, 28)

    draw.text((px1 + 44, py1 + 28), "Messages",
              fill=(170, 170, 185), font=f_app)
    draw.text((px2 - 44, py1 + 28), params.timestamp or "now",
              fill=(170, 170, 185), font=f_time, anchor="ra")

    # Sender name
    draw.text((px1 + 44, py1 + 78), params.sender_name,
              fill=_TEXT_LIGHT, font=f_name)

    # SMS bubble
    bbl_top = py1 + 152
    bbl_bot = py2 - 28
    _rrect(draw, px1 + 44, bbl_top, px2 - 44, bbl_bot,
           radius=22, fill=_BUBBLE_SMS)

    # Body text (max 5 lines inside bubble)
    ty = bbl_top + 22
    for line in wrap(params.body_text, width=26)[:5]:
        draw.text((px1 + 72, ty), line, fill=_TEXT_DARK, font=f_body)
        ty += 46

    img.save(str(out))
    logger.info(f"[UI] SMS PNG → {out.name}")


def _email_png(params: UIPopupParams, out: Path) -> None:
    """Draw an email notification card."""
    from PIL import Image, ImageDraw

    img  = Image.new("RGB", (W, H), _BG)
    draw = ImageDraw.Draw(img)

    px1, py1 = 40, 180
    px2, py2 = W - 40, 700
    _rrect(draw, px1, py1, px2, py2, radius=38, fill=_PANEL_BG,
           outline=_PANEL_STROKE, width=2)

    f_app  = _font(config.UI_FONT_PATH, 28)
    f_name = _font(config.UI_FONT_BOLD_PATH, 40)
    f_body = _font(config.UI_FONT_PATH, 34)
    f_time = _font(config.UI_FONT_PATH, 28)
    f_sub  = _font(config.UI_FONT_PATH, 28)

    app_label = params.app_name or "Mail"
    draw.text((px1 + 44, py1 + 26), app_label,
              fill=(170, 170, 185), font=f_app)
    draw.text((px2 - 44, py1 + 26), params.timestamp or "now",
              fill=(170, 170, 185), font=f_time, anchor="ra")

    draw.text((px1 + 44, py1 + 82), params.sender_name,
              fill=_TEXT_LIGHT, font=f_name)

    if params.sender_handle:
        draw.text((px1 + 44, py1 + 134), params.sender_handle,
                  fill=(150, 150, 180), font=f_sub)

    ty = py1 + 200
    for line in wrap(params.body_text, width=28)[:5]:
        draw.text((px1 + 44, ty), line, fill=(210, 210, 228), font=f_body)
        ty += 46

    img.save(str(out))
    logger.info(f"[UI] Email PNG → {out.name}")


# ─────────────────────────────────────────────
# ANIMATION: PNG → MP4 (slide-in from top)
# ─────────────────────────────────────────────

def _animate(png: Path, duration: float, out_mp4: Path) -> None:
    """
    Animate the notification card PNG:
      0.00 – 0.40s : slide in from top  (y: -H → 0)
      0.40 – (dur-0.35)s : hold
      (dur-0.35) – dur   : fade to black

    BUG FIX: On Windows, single-quoted expressions inside FFmpeg
    filter_complex strings cause cmd.exe parsing failures.
    We pass the entire filter_complex as a single Python string —
    FFmpeg receives it as one argument via the list-based subprocess
    API (no shell=True), so no shell escaping issues arise.
    """
    fade_start = max(0.1, duration - 0.35)

    # Build filter_complex as a plain Python string.
    # Use FFmpeg's if() / between() without any shell quoting.
    fc = (
        # Scale PNG to exact frame size
        f"[1:v]scale={W}:{H},setsar=1[popup];"
        # Overlay: slide in over 0.4s then hold
        f"[0:v][popup]overlay="
        f"x=0:"
        f"y=if(lt(t\\,0.4)\\,-{H}+(t/0.4*{H})\\,0):"
        f"enable=between(t\\,0\\,{duration})[out];"
        # Fade out
        f"[out]fade=t=out:st={fade_start:.3f}:d=0.35[final]"
    )

    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        # Input 0: black background at exact duration
        "-f", "lavfi",
        "-i", f"color=c=black:s={W}x{H}:r={FPS}:d={duration:.3f}",
        # Input 1: the rendered PNG
        "-i", str(png),
        "-filter_complex", fc,
        "-map", "[final]",
        "-c:v",    config.VIDEO_CODEC,
        "-preset", config.PRESET,
        "-crf",    str(config.CRF),
        "-r",      str(FPS),
        "-pix_fmt", "yuv420p",
        "-t",      str(duration),
        str(out_mp4),
    ], check=True, timeout=60)

    logger.info(f"[UI] Animated clip → {out_mp4.name} ({duration:.2f}s)")


# ─────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────

def render(params: UIPopupParams, block_id: int, duration: float) -> Path:
    """
    Render a UI notification popup clip.

    Returns:
        Path to a silent MP4, `duration` seconds long, 1080×1920 30fps.
    """
    out_mp4 = config.TMP_RENDER_DIR / f"block_{block_id:03d}_ui.mp4"
    if out_mp4.exists():
        logger.debug(f"[UI] Block {block_id}: cache hit")
        return out_mp4

    out_png = config.TMP_RENDER_DIR / f"block_{block_id:03d}_ui.png"

    if params.popup_type == "sms":
        _sms_png(params, out_png)
    else:
        _email_png(params, out_png)

    _animate(out_png, duration, out_mp4)
    return out_mp4
