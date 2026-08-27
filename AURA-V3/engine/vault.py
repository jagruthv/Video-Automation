import json
import logging
import random
import subprocess
from dataclasses import dataclass
from pathlib import Path
from config import (
    VAULT_ROOT, VAULT_DIR,
    KINETIC_SAND_PATH, LARGE_CLIP_THRESHOLD_MB,
    FFMPEG_PATH,
)

logger = logging.getLogger("aura.vault")

SUPPORTED_EXTENSIONS = {".mp4", ".mov", ".mkv"}
LARGE_THRESHOLD_BYTES = LARGE_CLIP_THRESHOLD_MB * 1024 * 1024

# Derive ffprobe path alongside ffmpeg (handles custom install paths)
_ffmpeg_path = Path(FFMPEG_PATH)
_FFPROBE = str(_ffmpeg_path.parent / "ffprobe") if _ffmpeg_path.parent != Path(".") else "ffprobe"

_HISTORY_FILE = Path("data") / "clip_history.json"
_HISTORY_MAX  = 10  # never reuse a concat combination within the last N renders


class _ClipHistory:
    """Persists the last N concat hashes to prevent visual repetition across videos."""

    def __init__(self, path: Path = _HISTORY_FILE, maxlen: int = _HISTORY_MAX):
        self._path   = path
        self._maxlen = maxlen
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._history: list[str] = self._load()

    def _load(self) -> list[str]:
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save(self) -> None:
        try:
            self._path.write_text(
                json.dumps(self._history, indent=2), encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"[VAULT] Could not save clip history: {e}")

    def seen(self, key: str) -> bool:
        return key in self._history

    def record(self, key: str) -> None:
        if key in self._history:
            return
        self._history.append(key)
        if len(self._history) > self._maxlen:
            self._history = self._history[-self._maxlen:]
        self._save()
        logger.info(f"[VAULT] Recorded clip combo to history ({len(self._history)}/{self._maxlen})")


_clip_history = _ClipHistory()


# ── Hook Score: Auto-rate clips by scene-change density in first 5 seconds ──
# Cached permanently in data/clip_scores.json after first probe.
# Score 1-5: higher = more visual action in opening seconds → better hook.

_SCORES_FILE = Path("data") / "clip_scores.json"


class _ClipScorer:
    """Lazy, cached FFprobe-based hook scorer for vault clips."""

    def __init__(self, path: Path = _SCORES_FILE):
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._scores: dict[str, int] = self._load()

    def _load(self) -> dict:
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save(self) -> None:
        try:
            self._path.write_text(json.dumps(self._scores, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"[VAULT] Could not save clip scores: {e}")

    def score(self, clip: Path) -> int:
        """Return cached score or compute it via FFprobe scene detection."""
        key = str(clip)
        if key in self._scores:
            return self._scores[key]

        s = self._compute(clip)
        self._scores[key] = s
        self._save()
        return s

    def _compute(self, clip: Path) -> int:
        """
        Count I-frames (keyframes) in the first 5 seconds of the clip.
        More keyframes = faster cuts = more action = higher hook score.
        Normalised to 1-5 scale based on typical satisfying clip ranges.
        """
        try:
            result = subprocess.run(
                [
                    _FFPROBE, "-v", "error",
                    "-select_streams", "v:0",
                    "-read_intervals", "%+5",  # only first 5 seconds
                    "-show_entries", "frame=pict_type",
                    "-of", "csv=p=0",
                    str(clip),
                ],
                capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=15,
            )
            # Count I-frames (scene change boundaries)
            i_frames = result.stdout.count("I")
            # Map to 1-5: 0-1 → 1, 2-4 → 2, 5-9 → 3, 10-19 → 4, 20+ → 5
            if i_frames >= 20:  score = 5
            elif i_frames >= 10: score = 4
            elif i_frames >= 5:  score = 3
            elif i_frames >= 2:  score = 2
            else:                score = 1
            logger.debug(f"[VAULT] hook_score {score} ({i_frames} I-frames/5s): {clip.name}")
            return score
        except Exception as e:
            logger.debug(f"[VAULT] hook_score probe failed for {clip.name}: {e}")
            return 1  # default low score, don't crash


_clip_scorer = _ClipScorer()


class VaultEmptyError(Exception):
    """Raised when no valid video files are found anywhere in the vault."""
    pass


@dataclass
class VaultClip:
    """Represents a clip selection, with optional seek offset for large files."""
    path:       Path
    seek_start: float  # seconds -- 0.0 means start from beginning (small clips)
    is_large:   bool   # if True, compositor will use -ss seek instead of stream_loop


class VaultManager:
    """
    Randomly selects a background clip from all available sources:

    1. Small clips (< 500 MB) — all .mp4/.mov/.mkv under VAULT_ROOT (subdirs scanned)
       D:\\Automation\\Vaults\\Satisfying_Clips\\   ← Pinterest / satisfying loops
       D:\\Automation\\Vaults\\12hr_Clips\\          ← any extra segments you add

    2. Large long-form clip — kinetic_sand_vault_1.mp4 (3.49 GB, 12hr)
       A random start timestamp is picked via ffprobe; only a window is used.

    Selection is folder/source-weighted — each source gets equal probability
    regardless of how many clips it contains.
    """

    def __init__(
        self,
        vault_root:   Path = VAULT_ROOT,
        fallback:     Path = VAULT_DIR,
        kinetic_sand: Path = KINETIC_SAND_PATH,
    ):
        self.vault_root   = Path(vault_root)
        self.fallback     = Path(fallback)
        self.kinetic_sand = Path(kinetic_sand)

    # ── Public API ──────────────────────────────────────────────────────────

    def pick_clip(self, needed_source_s: float = 600.0) -> VaultClip:
        """Pick a random background clip.
        needed_source_s: seconds of UNFILTERED source video required (= output_duration * VIDEO_SPEED).
        This ensures large-file seek leaves enough content after the seek point.
        """
        sources = self._build_sources(needed_source_s=needed_source_s)

        if not sources:
            raise VaultEmptyError(
                f"[VAULT] No clips found.\n"
                "Add .mp4 files to:\n"
                "   D:\\Automation\\Vaults\\Satisfying_Clips\\\n"
                "   D:\\Automation\\Vaults\\12hr_Clips\\\n"
                f"Large clip: {self.kinetic_sand}"
            )

        # Equal chance per source type
        chosen_source = random.choice(sources)
        return chosen_source

    # ── Source builders ─────────────────────────────────────────────────────

    def _build_sources(self, needed_source_s: float = 600.0) -> list[VaultClip]:
        """Build the weighted source pool: concatenated small clips + kinetic sand."""
        pool: list[VaultClip] = []

        # ── Small clips: concatenate multiple different clips into one temp file ──
        small_clips = self._collect_small_clips()
        if small_clips:
            concat_clip = self._build_concat_clip(small_clips, needed_source_s)
            if concat_clip:
                pool.append(VaultClip(path=concat_clip, seek_start=0.0, is_large=False))

        # ── Kinetic sand large clip ──────────────────────────────────────────
        if self.kinetic_sand.exists():
            min_reserve = needed_source_s + 120.0
            seek = self._random_seek_offset(self.kinetic_sand, min_reserve)
            pool.append(VaultClip(path=self.kinetic_sand, seek_start=seek, is_large=True))
        else:
            logger.warning(
                f"[VAULT] Kinetic sand not found at {self.kinetic_sand} — "
                f"using small clips only"
            )

        return pool

    def _collect_small_clips(self) -> list[Path]:
        search_root = self.vault_root if self.vault_root.exists() else self.fallback
        clips = [
            f for f in search_root.rglob("*")
            if f.suffix.lower() in SUPPORTED_EXTENSIONS
            and f.is_file()
            and f.stat().st_size < LARGE_THRESHOLD_BYTES
        ]
        # Sort by hook_score descending so the front of the list = most action
        clips.sort(key=lambda c: _clip_scorer.score(c), reverse=True)
        return clips

    def _build_concat_clip(self, clips: list[Path], needed_source_s: float) -> Path | None:
        """
        Shuffle the clip pool and ffmpeg-concat enough different clips to cover
        needed_source_s seconds, writing a single temp MP4.
        Returns the path to the temp file, or None on failure.
        """
        import tempfile, os
        tmp_dir = Path("tmp") / "vault_cache"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        # Pick clips in random order until we have enough duration
        # Shuffle multiple times and try different combinations to find one
        # not seen in the last 10 renders
        shuffled_pool = clips[:]
        random.shuffle(shuffled_pool)

        best_selected: list[Path] = []
        best_key = ""

        for attempt in range(8):  # up to 8 shuffle attempts to find a fresh combo
            shuffled = shuffled_pool[:]
            random.shuffle(shuffled)

            selected: list[Path] = []
            total_s = 0.0
            for clip in shuffled:
                dur = self._probe_clip_duration(clip)
                if dur <= 0:
                    continue
                selected.append(clip)
                total_s += dur
                if total_s >= needed_source_s + 30:
                    break

            if not selected:
                continue

            combo_key = str(abs(hash(tuple(sorted(str(s) for s in selected)))))

            if not _clip_history.seen(combo_key):
                best_selected = selected
                best_key      = combo_key
                total_s_final = total_s
                break  # Found a fresh combination

            # Keep as fallback if all combos are seen
            if not best_selected:
                best_selected = selected
                best_key      = combo_key
                total_s_final = total_s

        selected = best_selected
        total_s  = total_s_final if best_selected else 0.0

        if not selected:
            logger.warning("[VAULT] Could not build concat clip — no probable clips.")
            return None

        # Guarantee the highest hook_score clip is first in the concat
        # (scores are pre-sorted, but the shuffle may have moved them around)
        if len(selected) > 1:
            best_idx = max(range(len(selected)), key=lambda i: _clip_scorer.score(selected[i]))
            if best_idx != 0:
                selected[0], selected[best_idx] = selected[best_idx], selected[0]
                logger.info(f"[VAULT] Hook clip promoted to position 0: {selected[0].name} (score={_clip_scorer.score(selected[0])})")

        # Instead of the fragile concat demuxer with -c copy, we use filter_complex.
        # This safely handles clips with different resolutions, codecs, and framerates.
        inputs = []
        filter_parts = []
        concat_labels = []

        for i, clip in enumerate(selected):
            inputs.extend(["-i", str(clip)])
            # Scale, crop, normalize FPS and pixel format to ensure perfect concatenation
            filter_parts.append(
                f"[{i}:v]scale=1080:1920:force_original_aspect_ratio=increase,"
                f"crop=1080:1920,fps=30,format=yuv420p[v{i}]"
            )
            concat_labels.append(f"[v{i}]")

        filter_complex = "; ".join(filter_parts) + "; "
        filter_complex += "".join(concat_labels) + f"concat=n={len(selected)}:v=1:a=0[outv]"

        out_path = tmp_dir / f"concat_{best_key}.mp4"
        if out_path.exists():
            logger.info(f"[VAULT] Concat cache hit: {out_path.name} ({len(selected)} clips, {total_s:.0f}s)")
            _clip_history.record(best_key)
            return out_path

        logger.info(f"[VAULT] Building normalized concat from {len(selected)} Pinterest clips ({total_s:.0f}s total)...")
        
        ffmpeg_cmd = [
            _ffmpeg_path if isinstance(_ffmpeg_path, str) else str(_ffmpeg_path),
            "-y"
        ] + inputs + [
            "-filter_complex", filter_complex,
            "-map", "[outv]",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "22",
            "-an", # No audio needed from background
            str(out_path)
        ]

        result = subprocess.run(ffmpeg_cmd, capture_output=True, timeout=300)

        if result.returncode != 0 or not out_path.exists():
            logger.warning(f"[VAULT] Concat build failed: {result.stderr[-300:]}")
            return None

        _clip_history.record(best_key)  # Mark this combo as used
        logger.info(f"[VAULT] Concat ready: {out_path.name} ({out_path.stat().st_size/1024/1024:.1f} MB)")
        return out_path

    def _probe_clip_duration(self, path: Path) -> float:
        """Probe duration of a clip quickly; returns 0.0 on failure."""
        try:
            result = subprocess.run(
                [_FFPROBE, "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
            )
            return float(result.stdout.strip())
        except Exception:
            return 0.0

    def _random_seek_offset(self, path: Path, min_reserve_s: float = 900.0) -> float:
        """
        Probe total duration of a large file, then pick a random start point
        that guarantees at least min_reserve_s of content remains after the seek.
        min_reserve_s = needed_source_s + 120s safety buffer (computed by caller).
        """
        try:
            result = subprocess.run(
                [
                    _FFPROBE, "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    str(path),
                ],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
            )
            total = float(result.stdout.strip())
            safe_end = max(total - min_reserve_s, 0)
            offset   = random.uniform(0, safe_end)
            logger.info(
                f"[VAULT] Kinetic sand seek: {offset/60:.1f}min / {total/3600:.1f}hr "
                f"| reserve={min_reserve_s:.0f}s  ({path.name})"
            )
            return offset
        except Exception as e:
            logger.warning(f"[VAULT] Could not probe {path.name}: {e} — seeking to 0")
            return 0.0
