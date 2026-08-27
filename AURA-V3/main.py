import logging
import logging.handlers
import os
from pathlib import Path
from config import LOG_PATH
from engine.db import DatabaseTracker
from engine.audio import AudioEngine, AudioPartialError
from engine.vault import VaultManager, VaultEmptyError
from engine.compositor import FFmpegCompositor
from engine.script_guard import check_and_trim
from engine.rewriter import rewrite_and_chunk
from engine.balance import byop_has_credits
from engine import metadata as meta_engine

# ── Logging Setup ──────────────────────────────────────────────────────────
handler = logging.handlers.RotatingFileHandler(
    LOG_PATH, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[handler, logging.StreamHandler()],
)
logger = logging.getLogger("aura.main")

# ── Module Init ────────────────────────────────────────────────────────────
db         = DatabaseTracker()
audio_eng  = AudioEngine()
vault_mgr  = VaultManager()
compositor = FFmpegCompositor()

# ── Cross-process render lock (shared with api.py threads) ──────────────────
def _lock_path(video_id: str) -> Path:
    return Path("tmp") / f".render_{video_id}.lock"

def _acquire_lock(video_id: str) -> bool:
    """Returns True if lock was acquired (safe to render). False if already locked."""
    import psutil
    lock = _lock_path(video_id)
    lock.parent.mkdir(parents=True, exist_ok=True)
    
    if lock.exists():
        try:
            old_pid = int(lock.read_text().strip())
            if not psutil.pid_exists(old_pid):
                logger.warning(f"[PIPELINE] Found stale lock for {video_id} (PID {old_pid} dead). Clearing it.")
                lock.unlink(missing_ok=True)
            else:
                return False
        except Exception:
            # If reading PID fails (empty file, etc), assume stale and overwrite
            lock.unlink(missing_ok=True)
            
    lock.write_text(str(os.getpid()))
    return True

def _release_lock(video_id: str):
    lock = _lock_path(video_id)
    try: lock.unlink(missing_ok=True)
    except Exception: pass


def run_pipeline(row):
    video_id    = row["video_id"]
    
    if not _acquire_lock(video_id):
        logger.warning(f"[PIPELINE] ID {video_id} is already rendering in another process. Aborting duplicate run.")
        return False

    title       = row["title"]
    script_text = row["script_text"]
    voice       = row["voice"] or "nova"

    logger.info(f"\n{'='*60}")
    logger.info(f"[PIPELINE] Rendering: \"{title[:60]}\"")
    logger.info(f"[PIPELINE] ID: {video_id} | Voice: {voice}")

    try:
        logger.info("[PIPELINE] Started")
        
        # ── Step 1 & 2: Rewriting and Metadata
        if row["generation_status"] == "pending" and not row["audio_remaining_script"]:
            effective_script = check_and_trim(script_text, video_id=video_id, title=title)
            
            # --- QUALITY GATE ---
            passed, notes = meta_engine.quality_check(effective_script, title)
            if not passed:
                raise RuntimeError(f"Script Quality Check Failed: {notes}")
            
            logger.info("[PIPELINE] send the full JSON script to ai and ask for rewrite")
            result = rewrite_and_chunk(effective_script, title)
            rewritten_script = result["script"]
            # Update title if the LLM produced a better Story-First one
            if result.get("title") and result["title"] != title:
                title = result["title"]
                db.update_status(video_id, "pending", title=title)
                logger.info(f"[PIPELINE] Title upgraded to: {title[:70]}")

            
            # Save the rewritten script so we don't lose it if we pause 
            db.save_partial_audio(video_id, Path(""), rewritten_script)
            
            logger.info("[PIPELINE] use ai to get description, title, tags")
            meta = meta_engine.generate(rewritten_script, title)
            db.save_metadata(
                video_id, yt_title=meta["yt_title"], description=meta["description"],
                tags=meta["tags"], thumbnail_path=None
            )
            # Re-fetch row so loop logic uses the newly saved data
            row = db.get_video(video_id)
            logger.info("[PIPELINE] success done.")

        full_script = row["audio_remaining_script"]

        from engine.audio import TMP_AUDIO_DIR, TTS_TIMEOUT_S, _tts_request
        import urllib.error, time

        # ── Step 5: Full Audio Generation
        concat_path = TMP_AUDIO_DIR / f"{video_id}_full.mp3"
        
        if not concat_path.exists() or concat_path.stat().st_size < 5000:
            # Check Balance before generating
            logger.info(f"[PIPELINE] Checking balance before full audio...")
            from engine.balance import byop_has_credits
            credits_ok = byop_has_credits(force_recheck=True)
            from config import TTS_MODEL
            if not credits_ok and TTS_MODEL != "gemini-tts":
                logger.info(f"[PIPELINE] balance <= 0.04 pollen. Storing state to warehouse. Will resume if clicked Continue.")
                return
                
            logger.info(f"[PIPELINE] using full script for audio rendering | {len(full_script.split())} words")
            
            try:
                audio_path = audio_eng.generate(full_script, video_id, voice)
                import shutil
                shutil.copy2(audio_path, concat_path)
            except urllib.error.HTTPError as e:
                if e.code in (401, 402, 403):
                    logger.warning(f"[PIPELINE] BYOP HTTP {e.code} - balance depleted exactly mid-pipeline. Freezing state.")
                    from engine.balance import invalidate_cache
                    invalidate_cache()
                    return
                raise
            except Exception as e:
                raise RuntimeError(f"All TTS attempts failed for full audio: {e}")

            logger.info(f"[PIPELINE] Audio generation success. Storing audio...")
            db.update_status(video_id, "audio_done", audio_path=str(concat_path))
            row = db.get_video(video_id)

        # ── Step 8: Thumbnail
        import json as _json
        # Re-fetch row to get latest state (audio_done, yt_title etc.)
        row = db.get_video(video_id)
        tags = _json.loads(row["tags"]) if row["tags"] else []
        if row["yt_title"]:
            logger.info("[PIPELINE] after getting all the audio, get the thumbnail from BYOP pollinations")
            try:
                thumb_path = meta_engine.thumbnail(f"Cinematic thumbnail for: {row['yt_title']}", video_id)
            except Exception as thumb_err:
                logger.warning(f"[PIPELINE] Thumbnail generation failed ({thumb_err}) — continuing without thumbnail.")
                thumb_path = None
            
            # Unconditionally save the text metadata. If thumbnail failed, commit it natively anyway.
            db.save_metadata(
                video_id, 
                yt_title=row["yt_title"], 
                description=row["description"],
                tags=tags, 
                thumbnail_path=str(thumb_path) if thumb_path else ""
            )

        # ── Step 10: Composite video ──────────────────────────────────────────
        logger.info("[PIPELINE] get the required clips and whisper local model to tract timestamps...")
        video_mode = (dict(row).get("mode") or "standard").strip().lower()

        if video_mode == "8":
            logger.info("[PIPELINE] MODE 8 — Human-Crafted visual pipeline")
            from engine.mode8.pipeline import run_mode8_visual
            output_path = run_mode8_visual(
                video_id=video_id,
                audio_path=concat_path,
                title=title,
                full_script=script_text or "",
            )
        else:
            audio_duration_1x = compositor.probe_audio_duration(concat_path)
            source_needed_s   = (audio_duration_1x / compositor.TTS_SPEED) * compositor.VIDEO_SPEED
            clip = vault_mgr.pick_clip(needed_source_s=source_needed_s)
            output_path = compositor.render(clip, concat_path, video_id, title=title)
        db.update_status(video_id, "rendered", output_path=str(output_path))
        
        # ── Step 11: Transfer to Memory Registry
        logger.info("[PIPELINE] remove it from this database and send it to memory registory")
        success = db.transfer_to_v2_registry(video_id)
        if success:
            logger.info("[PIPELINE] Entire Cascade Successfully Completed!")
        else:
            logger.error("[PIPELINE] Pipeline finished, but failed transferring to Memory Registry.")

    except VaultEmptyError as e:
        logger.critical(str(e))
        db.update_status(video_id, "error", error_message=str(e))
        raise
    except Exception as e:
        logger.error(f"[PIPELINE] Failed ({video_id}): {e}", exc_info=True)
        db.update_status(video_id, "error", error_message=str(e)[:500])
    finally:
        _release_lock(video_id)


def run_chunk_pipeline(video_id: str, part_num: int):
    """
    Hook for partial resets or UI continues. 
    It just invokes the master pipeline cleanly!
    """
    row = db.get_video(video_id)
    if row: run_pipeline(row)


def main():
    pending = db.get_pending()

    if not pending:
        logger.info("[MAIN] Queue is empty. Run ingest.py to add videos.")
        return

    partial = [r for r in pending if r["generation_status"] == "audio_partial"]
    fresh   = [r for r in pending if r["generation_status"] == "pending"]
    if partial:
        logger.info(f"[MAIN] {len(partial)} video(s) resuming from audio_partial checkpoint.")
    if fresh:
        logger.info(f"[MAIN] {len(fresh)} new video(s) in queue.")

    for row in pending:
        run_pipeline(row)

    logger.info("[MAIN] All done.")


if __name__ == "__main__":
    main()
