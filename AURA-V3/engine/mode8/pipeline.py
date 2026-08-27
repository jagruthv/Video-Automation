"""
Mode 8 Visual Pipeline
Handles custom, human-crafted visual pipelines instead of the standard random gameplay looping.
"""
from pathlib import Path
import logging

logger = logging.getLogger("aura.mode8")

def run_mode8_visual(video_id: str, audio_path: str, title: str, full_script: str) -> str:
    """
    Run the Mode 8 custom visual rendering pipeline.
    Currently falls back to the standard compositor logic or returns a dummy path until fully implemented.
    """
    logger.info(f"[MODE 8] Running custom visual generation for {video_id}")
    
    # Import locally to avoid circular dependencies
    from engine import compositor
    from engine import vault
    
    # Temporary fallback: use standard clip mapping
    vault_mgr = vault.VaultManager()
    audio_duration_1x = compositor.probe_audio_duration(Path(audio_path))
    source_needed_s   = (audio_duration_1x / compositor.TTS_SPEED) * compositor.VIDEO_SPEED
    
    try:
        clip = vault_mgr.pick_clip(needed_source_s=source_needed_s)
        output_path = compositor.render(clip, Path(audio_path), video_id, title=title)
        return str(output_path)
    except Exception as e:
        logger.error(f"[MODE 8] Fallback render failed: {e}")
        raise e
