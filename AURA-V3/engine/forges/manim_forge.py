"""
engine/forges/manim_forge.py — AURA-V3 Manim Forge
=====================================================
Generates two animation types:

  Manim_Legal_Doc  — White legal document with animated yellow highlighter.
  Manim_Flowchart  — Sequential node-and-arrow flowchart.

Strategy:
  1. Serialize all user data to a JSON sidecar file (avoids f-string
     injection bugs when text contains quotes, curly braces, etc.)
  2. Generated Python scene script loads data from the JSON sidecar at runtime.
  3. Run `manim` via subprocess with explicit pixel_width/pixel_height/frame_rate.
  4. Re-encode Manim's raw output to AURA-V3 standard via FFmpeg.

Critical fixes applied:
  - Data injected via JSON sidecar (not f-string repr) to avoid SyntaxErrors
    when document_text contains quotes or curly braces.
  - Generated scripts use hard pixel values (1080, 1920) — NOT `config.frame_*`
    which in the Manim process refers to Manim's own config object, not ours.
  - textwrap auto-scales font size so text never bleeds off the 9:16 frame.
"""

import json
import logging
import subprocess
import textwrap
from pathlib import Path

import config
from models import ManimFlowchartParams, ManimLegalDocParams

logger = logging.getLogger("aura.forge.manim")

# Exact pixel dimensions passed to Manim CLI — never use config.frame_* inside
# the generated scripts; that refers to Manim's runtime config, not ours.
W   = config.OUTPUT_WIDTH    # 1080
H   = config.OUTPUT_HEIGHT   # 1920
FPS = config.OUTPUT_FPS      # 30

# Layout budget (pixels at 1080-wide)
_MARGIN_X     = 80
_MARGIN_Y     = 200
_LINE_H_PX    = 52
_CHARS_PER_PX = 14   # approx characters per pixel-width at default Manim font


# ─────────────────────────────────────────────
# JSON SIDECAR WRITER
# ─────────────────────────────────────────────

def _write_sidecar(data: dict, block_id: int) -> Path:
    """
    Write data dict as a JSON sidecar that the generated Manim script
    will load at runtime. This decouples user text from Python syntax
    entirely — no f-string injection, no quote-escaping needed.
    """
    path = config.TMP_RENDER_DIR / f"block_{block_id:03d}_data.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


# ─────────────────────────────────────────────
# LEGAL DOC SCENE SCRIPT
# ─────────────────────────────────────────────

def _legal_script(sidecar: Path) -> str:
    """
    Return a self-contained Manim scene Python string for the legal document.
    All dynamic data is loaded from the JSON sidecar — no user text is
    interpolated directly into this source code.
    """
    sidecar_posix = sidecar.as_posix()
    return f'''
import json
from manim import *

# Load user data from sidecar (avoids injection / quoting issues)
with open({repr(sidecar_posix)}, encoding="utf-8") as _f:
    _d = json.load(_f)

_lines      = _d["lines"]
_title      = _d.get("title")
_highlights = _d["highlights"]
_font_size  = _d["font_size"]
_hl_gap     = _d["hl_gap"]

class LegalDocScene(Scene):
    def construct(self):
        # ── Parchment background ───────────────────────────────────────────
        bg = Rectangle(
            width=config.frame_width, height=config.frame_height,
            fill_color="#F5F0E8", fill_opacity=1, stroke_width=0,
        )
        self.add(bg)

        # ── White document card ────────────────────────────────────────────
        doc = Rectangle(
            width=config.frame_width - 1.0,
            height=config.frame_height - 1.2,
            fill_color="#FFFFFF", fill_opacity=1,
            stroke_color="#CCBBAA", stroke_width=2,
        ).move_to(ORIGIN)
        self.add(doc)

        # ── Optional title ─────────────────────────────────────────────────
        anchor = None
        if _title:
            title_obj = Text(_title, font_size=30, weight=BOLD, color=BLACK)
            title_obj.to_edge(UP, buff=0.9)
            self.play(FadeIn(title_obj), run_time=0.4)
            anchor = title_obj

        # ── Body text ─────────────────────────────────────────────────────
        body = Paragraph(
            *_lines,
            alignment="LEFT",
            font_size=_font_size,
            color=BLACK,
            line_spacing=1.15,
        ).to_edge(LEFT, buff=1.0)
        if anchor:
            body.next_to(anchor, DOWN, buff=0.35)
        self.play(Write(body, run_time=1.2))
        self.wait(0.3)

        # ── Highlight animation ────────────────────────────────────────────
        for phrase in _highlights:
            for submob in body:
                if hasattr(submob, "text") and phrase.lower() in submob.text.lower():
                    hl = SurroundingRectangle(
                        submob,
                        color=YELLOW, fill_color=YELLOW,
                        fill_opacity=0.45, buff=0.04,
                        corner_radius=0.02,
                    )
                    self.play(FadeIn(hl), run_time=0.3)
                    self.wait(_hl_gap)
                    break

        self.wait(0.5)
'''


# ─────────────────────────────────────────────
# FLOWCHART SCENE SCRIPT
# ─────────────────────────────────────────────

def _flowchart_script(sidecar: Path) -> str:
    """Return a self-contained Manim scene Python string for the flowchart."""
    sidecar_posix = sidecar.as_posix()
    return f'''
import json
from manim import *

with open({repr(sidecar_posix)}, encoding="utf-8") as _f:
    _d = json.load(_f)

_nodes     = _d["nodes"]
_edges     = _d["edges"]
_title     = _d.get("title")
_font_size = _d["font_size"]
_step_time = _d["step_time"]

class FlowchartScene(Scene):
    def construct(self):
        # ── Dark background ────────────────────────────────────────────────
        bg = Rectangle(
            width=config.frame_width, height=config.frame_height,
            fill_color="#0D0D1A", fill_opacity=1, stroke_width=0,
        )
        self.add(bg)

        # ── Optional title ─────────────────────────────────────────────────
        y_offset = 0
        if _title:
            t = Text(_title, font_size=28, color=WHITE, weight=BOLD)
            t.to_edge(UP, buff=0.6)
            self.play(Write(t), run_time=0.5)
            y_offset = 0.8   # push nodes down to avoid title overlap

        # ── Build nodes vertically ─────────────────────────────────────────
        n       = len(_nodes)
        avail_h = config.frame_height * 0.78 - y_offset
        spacing = avail_h / max(n - 1, 1)
        top_y   = avail_h / 2 - y_offset

        boxes, labels = [], []
        for i, label in enumerate(_nodes):
            y = top_y - i * spacing
            box = RoundedRectangle(
                width=4.6, height=0.88,
                corner_radius=0.22,
                fill_color="#1E3A5F", fill_opacity=1,
                stroke_color="#4FC3F7", stroke_width=2,
            ).move_to([0, y, 0])
            txt = Text(label, font_size=_font_size, color=WHITE).move_to(box)
            boxes.append(box)
            labels.append(txt)
            self.play(
                GrowFromCenter(box),
                Write(txt),
                run_time=_step_time,
            )

        # ── Draw arrows ────────────────────────────────────────────────────
        for src, dst in _edges:
            if 0 <= src < n and 0 <= dst < n:
                arrow = Arrow(
                    start=boxes[src].get_bottom(),
                    end=boxes[dst].get_top(),
                    color="#4FC3F7",
                    buff=0.06,
                    stroke_width=3,
                )
                self.play(GrowArrow(arrow), run_time=0.28)

        self.wait(0.8)
'''


# ─────────────────────────────────────────────
# RUNNER: script → manim → ffmpeg
# ─────────────────────────────────────────────

def _run(scene_class: str, script_text: str, block_id: int,
         duration: float, out_mp4: Path) -> Path:
    """
    Write the scene script file, invoke Manim CLI with explicit portrait
    dimensions, then re-encode Manim's raw output to AURA-V3 standard.
    """
    script_path = config.TMP_RENDER_DIR / f"block_{block_id:03d}_scene.py"
    media_dir   = config.TMP_RENDER_DIR / f"block_{block_id:03d}_manim_media"
    script_path.write_text(script_text, encoding="utf-8")
    media_dir.mkdir(parents=True, exist_ok=True)

    manim_cmd = [
        "manim",
        str(script_path),
        scene_class,
        "--media_dir",   str(media_dir),
        "--pixel_width",  str(W),     # 1080
        "--pixel_height", str(H),     # 1920
        "--frame_rate",   str(FPS),   # 30
        "-q", "l",                    # low quality = fast. Change to 'h' for production.
        "--disable_caching",
    ]

    logger.info(f"[MANIM] Block {block_id}: invoking {scene_class} "
                f"({W}x{H} @ {FPS}fps, low quality)...")
    res = subprocess.run(
        manim_cmd,
        capture_output=True,
        text=True,
        timeout=300,   # 5-minute hard cap — Manim can be slow
    )

    if res.returncode != 0:
        logger.error(
            f"[MANIM] Block {block_id} FAILED (exit {res.returncode}):\n"
            f"{res.stderr[-3000:]}"
        )
        raise RuntimeError(f"Manim rendering failed for block {block_id}. Check logs.")

    # ── Locate raw MP4 Manim wrote ─────────────────────────────────────────
    raw_list = sorted(media_dir.glob("**/*.mp4"))
    if not raw_list:
        raise FileNotFoundError(
            f"[MANIM] No MP4 found in {media_dir} after Manim run. "
            f"stdout: {res.stdout[-500:]}"
        )
    raw_mp4 = raw_list[-1]   # newest file if multiple

    # ── Re-encode: force exact 1080x1920, trim to audio duration ──────────
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(raw_mp4),
        "-t", str(duration),
        "-vf", (
            f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,"
            f"format=yuv420p"
        ),
        "-c:v",   config.VIDEO_CODEC,
        "-preset", config.PRESET,
        "-crf",   str(config.CRF),
        "-r",     str(FPS),
        str(out_mp4),
    ], check=True, timeout=120)

    logger.info(f"[MANIM] Block {block_id}: encoded → {out_mp4.name}")
    return out_mp4


# ─────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────

def render_legal_doc(params: ManimLegalDocParams, block_id: int, duration: float) -> Path:
    """Render a legal document animation clip. Returns silent MP4 path."""
    out_mp4 = config.TMP_RENDER_DIR / f"block_{block_id:03d}_legal.mp4"
    if out_mp4.exists():
        logger.debug(f"[MANIM] Block {block_id}: legal doc cache hit")
        return out_mp4

    # Auto-scale font size based on text length
    usable_chars = int((W - 2 * _MARGIN_X) / _CHARS_PER_PX)
    wrapped      = textwrap.fill(params.document_text, width=usable_chars)
    lines        = wrapped.split("\n")
    max_lines    = int((H - _MARGIN_Y) / _LINE_H_PX)
    font_size    = 28 if len(lines) <= max_lines else max(14, int(28 * max_lines / len(lines)))
    hl_gap       = max(0.3, (duration - 1.5) / max(len(params.highlight_text), 1))

    sidecar = _write_sidecar({
        "lines"     : lines,
        "title"     : params.title,
        "highlights": params.highlight_text,
        "font_size" : font_size,
        "hl_gap"    : round(hl_gap, 3),
    }, block_id)

    return _run("LegalDocScene", _legal_script(sidecar), block_id, duration, out_mp4)


def render_flowchart(params: ManimFlowchartParams, block_id: int, duration: float) -> Path:
    """Render a flowchart animation clip. Returns silent MP4 path."""
    out_mp4 = config.TMP_RENDER_DIR / f"block_{block_id:03d}_flowchart.mp4"
    if out_mp4.exists():
        logger.debug(f"[MANIM] Block {block_id}: flowchart cache hit")
        return out_mp4

    n         = len(params.nodes)
    font_size = max(16, min(30, int(200 / max(n, 1))))
    step_time = round(max(0.3, (duration - 1.0) / max(n, 1)), 3)
    edges     = params.edges or [[i, i + 1] for i in range(n - 1)]

    sidecar = _write_sidecar({
        "nodes"    : params.nodes,
        "edges"    : edges,
        "title"    : params.title,
        "font_size": font_size,
        "step_time": step_time,
    }, block_id)

    return _run("FlowchartScene", _flowchart_script(sidecar), block_id, duration, out_mp4)
