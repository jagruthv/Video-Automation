"""
UI graphics / UI Animation Engine
===================================
Standalone, high-precision UI animation generator for 9:16 vertical shorts.
Renders pixel-perfect iOS/Modern mobile notification popups (SMS, Email, Push Alerts),
and compiles them into smooth 60fps/30fps MP4 video clips with top slide-in, hold, and fade animations.
"""

import os
import sys
import logging
import subprocess
from pathlib import Path
from textwrap import wrap
from dataclasses import dataclass
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ui_graphics")

W = 1080
H = 1920
FPS = 30

# Modern Color Palettes
_BG = (13, 13, 26)
_BUBBLE_SMS = (37, 211, 102)     # iMessage green
_BUBBLE_EM = (30, 80, 160)       # Email blue
_BUBBLE_ALERT = (255, 69, 58)    # iOS red alert
_TEXT_DARK = (20, 20, 20)
_TEXT_LIGHT = (240, 240, 240)
_PANEL_BG = (22, 22, 35)
_PANEL_STROKE = (60, 60, 80)


@dataclass
class UIPopupConfig:
    popup_type: str = "sms"  # "sms", "email", "alert"
    sender_name: str = "Unknown"
    body_text: str = ""
    timestamp: str = "now"
    app_name: Optional[str] = None
    sender_handle: Optional[str] = None


def get_font(size: int, bold: bool = False):
    """Load crisp system fonts (Segoe UI / Arial) or Pillow default."""
    from PIL import ImageFont
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_rounded_rectangle(draw, x1: int, y1: int, x2: int, y2: int, radius: int, fill, outline=None, width: int = 1):
    """Draw a smooth rounded rectangle."""
    draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, fill=fill, outline=outline, width=width)


def render_sms_png(config: UIPopupConfig, out_path: Path):
    """Render iOS SMS message notification card."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (W, H), _BG)
    draw = ImageDraw.Draw(img)

    px1, py1 = 40, 200
    px2, py2 = W - 40, 720
    draw_rounded_rectangle(draw, px1, py1, px2, py2, radius=38, fill=_PANEL_BG, outline=_PANEL_STROKE, width=2)

    f_app = get_font(30, bold=False)
    f_name = get_font(42, bold=True)
    f_body = get_font(36, bold=False)
    f_time = get_font(28, bold=False)

    draw.text((px1 + 44, py1 + 28), "Messages", fill=(170, 170, 185), font=f_app)
    draw.text((px2 - 44, py1 + 28), config.timestamp or "now", fill=(170, 170, 185), font=f_time, anchor="ra")
    draw.text((px1 + 44, py1 + 78), config.sender_name, fill=_TEXT_LIGHT, font=f_name)

    bbl_top = py1 + 152
    bbl_bot = py2 - 28
    draw_rounded_rectangle(draw, px1 + 44, bbl_top, px2 - 44, bbl_bot, radius=22, fill=_BUBBLE_SMS)

    ty = bbl_top + 22
    for line in wrap(config.body_text, width=26)[:5]:
        draw.text((px1 + 72, ty), line, fill=_TEXT_DARK, font=f_body)
        ty += 46

    img.save(str(out_path))
    logger.info(f"Generated SMS graphic: {out_path}")


def render_email_png(config: UIPopupConfig, out_path: Path):
    """Render email notification card."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (W, H), _BG)
    draw = ImageDraw.Draw(img)

    px1, py1 = 40, 180
    px2, py2 = W - 40, 700
    draw_rounded_rectangle(draw, px1, py1, px2, py2, radius=38, fill=_PANEL_BG, outline=_PANEL_STROKE, width=2)

    f_app = get_font(28, bold=False)
    f_name = get_font(40, bold=True)
    f_body = get_font(34, bold=False)
    f_time = get_font(28, bold=False)
    f_sub = get_font(28, bold=False)

    app_label = config.app_name or "Mail"
    draw.text((px1 + 44, py1 + 26), app_label, fill=(170, 170, 185), font=f_app)
    draw.text((px2 - 44, py1 + 26), config.timestamp or "now", fill=(170, 170, 185), font=f_time, anchor="ra")
    draw.text((px1 + 44, py1 + 82), config.sender_name, fill=_TEXT_LIGHT, font=f_name)

    if config.sender_handle:
        draw.text((px1 + 44, py1 + 134), config.sender_handle, fill=(150, 150, 180), font=f_sub)

    ty = py1 + 200
    for line in wrap(config.body_text, width=28)[:5]:
        draw.text((px1 + 44, ty), line, fill=(210, 210, 228), font=f_body)
        ty += 46

    img.save(str(out_path))
    logger.info(f"Generated Email graphic: {out_path}")


def animate_card(png_path: Path, duration: float, out_mp4: Path) -> Path:
    """Animate PNG into MP4 video clip with slide-in from top, hold, and smooth fade out."""
    fade_start = max(0.1, duration - 0.35)
    fc = (
        f"[1:v]scale={W}:{H},setsar=1[popup];"
        f"[0:v][popup]overlay=x=0:y=if(lt(t\\,0.4)\\,-{H}+(t/0.4*{H})\\,0):enable=between(t\\,0\\,{duration})[out];"
        f"[out]fade=t=out:st={fade_start:.3f}:d=0.35[final]"
    )

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi",
        "-i", f"color=c=black:s={W}x{H}:r={FPS}:d={duration:.3f}",
        "-i", str(png_path),
        "-filter_complex", fc,
        "-map", "[final]",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "18",
        "-r", str(FPS),
        "-pix_fmt", "yuv420p",
        "-t", str(duration),
        str(out_mp4)
    ]
    subprocess.run(cmd, check=True)
    logger.info(f"Rendered animated UI video: {out_mp4} ({duration:.2f}s)")
    return out_mp4


def generate_ui_clip(config: UIPopupConfig, duration: float, output_dir: Path) -> Path:
    """High-level function to generate an animated UI video clip."""
    output_dir.mkdir(parents=True, exist_ok=True)
    png_path = output_dir / f"ui_{config.popup_type}.png"
    mp4_path = output_dir / f"ui_{config.popup_type}.mp4"

    if config.popup_type == "email":
        render_email_png(config, png_path)
    else:
        render_sms_png(config, png_path)

    return animate_card(png_path, duration, mp4_path)
