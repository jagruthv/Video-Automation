"""
forge_main.py — AURA-V3 Forge Pipeline Entry Point
====================================================
Orchestrates the complete pipeline:

  Stage 1 — Validation  : Pydantic validates the Director Script JSON
  Stage 2 — Audio Forge : TTS + speed-up for all blocks (cached)
  Stage 3 — Visual Forge: Route each block to the correct visual forge
  Stage 4 — Assembly    : Mux, normalize, burn captions, concat

Usage (CLI):
    python forge_main.py director_script.json

Usage (Python):
    from forge_main import run
    output_path = run(script_dict)
"""

import json
import logging
import sys
import time
import traceback
from pathlib import Path

# ── Initialize logging BEFORE any other imports that use logging ──────────
from engine.forges.logger_setup import init as _log_init

import config
from models import DirectorScript, TimelineBlock

logger = logging.getLogger("aura.forge_main")


# ─────────────────────────────────────────────
# VISUAL ENGINE ROUTER
# ─────────────────────────────────────────────

def _render_visual(block: TimelineBlock, duration: float) -> Path:
    """
    Route one block to its visual forge.
    All imports are lazy so heavy dependencies (manim, etc.)
    are only loaded when that engine is actually needed.
    """
    engine = block.Visual_Engine
    params = block.get_params()
    bid    = block.Block_ID

    logger.info(
        f"[MAIN] Block {bid}: dispatching to {engine} "
        f"(duration={duration:.2f}s)"
    )

    try:
        if engine == "Map_Engine":
            from engine.forges.map_forge import render
            return render(params, bid, duration)

        if engine == "Manim_Legal_Doc":
            from engine.forges.manim_forge import render_legal_doc
            return render_legal_doc(params, bid, duration)

        if engine == "Manim_Flowchart":
            from engine.forges.manim_forge import render_flowchart
            return render_flowchart(params, bid, duration)

        if engine == "UI_Popup":
            from engine.forges.ui_forge import render
            return render(params, bid, duration)

        if engine == "Background_Vault":
            from engine.forges.vault_forge import render
            return render(params, bid, duration)

        raise ValueError(f"Unknown Visual_Engine: '{engine}'")

    except Exception as exc:
        logger.critical(
            f"[MAIN] Block {bid} visual forge '{engine}' FAILED:\n"
            f"  Error: {exc}\n"
            f"  Params: {params}\n"
            f"  Traceback:\n{traceback.format_exc()}"
        )
        raise


# ─────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────

def run(script_data: dict) -> Path:
    """
    Execute the full AURA-V3 forge pipeline from a raw dict.

    Args:
        script_data: Parsed Director Script (dict matching DirectorScript schema).

    Returns:
        Path to the final assembled, captioned MP4.

    Raises:
        pydantic.ValidationError  if the Director Script is malformed.
        RuntimeError              if any forge or assembly step fails.
    """
    run_start = time.time()

    # -- Stage 0: Initialize logging ----------------------------------------
    # Title isn't known yet — pass empty string; we update slug after validation
    log_file = _log_init()

    # -- Stage 1: Validate Director Script ---------------------------------
    logger.info("=" * 60)
    logger.info("  AURA-V3 FORGE PIPELINE  --  START")
    logger.info("=" * 60)

    try:
        script = DirectorScript.model_validate(script_data)
    except Exception as exc:
        logger.critical(
            f"[MAIN] Director Script validation FAILED.\n"
            f"  This means your JSON is malformed or missing required fields.\n"
            f"  Error detail: {exc}"
        )
        raise

    title      = script.Video_Metadata.Title
    n_blocks   = len(script.Timeline)

    # Re-init logging with the title slug in the filename
    title_slug = "".join(c for c in title if c.isalnum() or c in "_-")[:30]
    log_file   = _log_init(run_tag=title_slug)

    logger.info(f"  Title   : {title}")
    logger.info(f"  Blocks  : {n_blocks}")
    logger.info(f"  Log     : {log_file.name}")
    logger.info("-" * 60)

    # -- Stage 2: Audio Forge -----------------------------------------------
    logger.info("[MAIN] -- STAGE 1: AUDIO FORGE --")
    t0 = time.time()

    from engine.forges.audio_forge import generate_all
    audio_map = generate_all(script.Timeline)
    # audio_map: {Block_ID: (mp3_path, duration_secs)}

    logger.info(
        f"[MAIN] Audio stage complete in {time.time()-t0:.1f}s. "
        f"Durations: { {k: round(v[1],2) for k,v in audio_map.items()} }"
    )

    # -- Stage 3: Visual Forges ---------------------------------------------
    logger.info("[MAIN] -- STAGE 2: VISUAL FORGES --")
    t0 = time.time()

    visual_map: dict[int, Path] = {}
    for block in script.Timeline:
        _, duration = audio_map[block.Block_ID]
        visual_map[block.Block_ID] = _render_visual(block, duration)

    logger.info(
        f"[MAIN] Visual stage complete in {time.time()-t0:.1f}s."
    )

    # -- Stage 4: Assembly + Captions --------------------------------------
    logger.info("[MAIN] -- STAGE 3: ASSEMBLY + CAPTIONS --")
    t0 = time.time()

    # Build lookup: Block_ID -> TimelineBlock
    block_lookup = {b.Block_ID: b for b in script.Timeline}

    block_segments: dict[int, tuple[Path, Path, str]] = {
        bid: (
            visual_map[bid],
            audio_map[bid][0],
            block_lookup[bid].Audio_Narration,
        )
        for bid in sorted(visual_map.keys())
    }

    from engine.forges.assembly import assemble
    out_mp4 = assemble(block_segments, title)

    logger.info(
        f"[MAIN] Assembly complete in {time.time()-t0:.1f}s."
    )

    # -- Summary ------------------------------------------------------------
    total_elapsed = time.time() - run_start
    logger.info("=" * 60)
    logger.info(f"  PIPELINE COMPLETE in {total_elapsed:.1f}s ({total_elapsed/60:.1f} min)")
    logger.info(f"  Output: {out_mp4}")
    logger.info("=" * 60)

    return out_mp4


# ---------------------------------------------
# CLI ENTRY POINT
# ─────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python forge_main.py <director_script.json>")
        print()
        print("Example:")
        print("  python forge_main.py test_forge.py  (runs the built-in smoke test)")
        sys.exit(1)

    json_path = Path(sys.argv[1])
    if not json_path.exists():
        print(f"ERROR: File not found: {json_path}")
        sys.exit(1)

    try:
        with open(json_path, encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:
        print(f"ERROR: Invalid JSON in {json_path}: {exc}")
        sys.exit(1)

    try:
        output = run(data)
        print(f"\n✅  Video rendered: {output}")
        sys.exit(0)
    except Exception as exc:
        # Full traceback is already in the log file — just show summary to user
        print(f"\n❌  Pipeline FAILED: {exc}")
        print(f"    Check the logs/ directory for full details.")
        sys.exit(2)
