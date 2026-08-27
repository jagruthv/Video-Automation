import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

"""
AURA-V3 — Data Ingestion Script
================================
Reads `data/payload.json` (Gemini extraction output) and safely injects
each entry into the SQLite pipeline queue via DatabaseTracker.

Hashing Strategy:
  video_id = SHA256(Remixed_Audio_Script)
  This guarantees that the exact same script can never be rendered twice,
  regardless of whether the Source_Video title or ID changes.

Usage:
  python ingest.py                         # reads data/payload.json
  python ingest.py --file data/custom.json # reads a custom file
  python ingest.py --voice bella           # override voice for all entries
"""

import argparse
import hashlib
import json
import logging
import sys
from pathlib import Path

# Ensure the project root is on the path when running as a standalone script
sys.path.insert(0, str(Path(__file__).parent))

from engine.db import DatabaseTracker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ingest] %(levelname)s: %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("aura.ingest")

DEFAULT_PAYLOAD_PATH = Path(__file__).parent / "data" / "payload.json"
# Valid voices for Qwen3-TTS Flash (qwen-tts) via Pollinations:
# alloy | echo | fable | onyx | nova | shimmer
# 'adam', 'george', 'bella', 'antoni' were ElevenLabs-only — INVALID with qwen-tts.
VALID_VOICES = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}


# ── Helpers ────────────────────────────────────────────────────────────────

def sha256_of(text: str) -> str:
    """Return the first 16 hex chars of a SHA256 hash — short but collision-safe."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def load_payload(file_path: Path) -> list[dict]:
    """
    Load and parse the JSON payload. Raises clear errors for missing
    files or malformed JSON before anything gets written to the DB.
    """
    if not file_path.exists():
        raise FileNotFoundError(
            f"Payload not found at: {file_path}\n"
            f"→ Place your Gemini JSON output at that path and re-run."
        )

    raw = file_path.read_text(encoding="utf-8")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in payload file: {e}") from e

    if not isinstance(data, list):
        raise TypeError(
            f"Expected a JSON array at the root level, got: {type(data).__name__}.\n"
            f"Wrap your single object in [ ... ] if needed."
        )

    return data


def validate_entry(entry: dict, index: int) -> tuple[bool, str]:
    """
    Validate that a single entry has the required fields.
    Returns (is_valid, reason_string).
    """
    required = ["Source_Video", "Remixed_Audio_Script"]
    for field in required:
        if field not in entry:
            return False, f"Missing required field: '{field}'"
        if not isinstance(entry[field], str) or not entry[field].strip():
            return False, f"Field '{field}' is empty or not a string"
    return True, ""


# ── Core Ingestion ─────────────────────────────────────────────────────────

def ingest(file_path: Path, voice_override: str | None = None) -> None:
    """
    Parse the payload and insert each valid entry into the DB queue.
    Prints a clean summary upon completion.
    """
    logger.info(f"📂 Loading payload from: {file_path}")
    payload = load_payload(file_path)
    logger.info(f"📋 Found {len(payload)} entry/entries in payload.")

    if not payload:
        logger.warning("Payload is an empty array. Nothing to ingest.")
        return

    db = DatabaseTracker()

    # ── Counters ───────────────────────────────────────────────────────────
    queued    = 0   # Successfully inserted and newly queued
    skipped   = 0   # Already exists in DB (duplicate hash)
    malformed = 0   # Skipped due to missing/invalid fields

    for i, entry in enumerate(payload):
        entry_label = f"Entry #{entry.get('ID', i + 1)}"

        # ── Step 1: Validate fields ────────────────────────────────────────
        is_valid, reason = validate_entry(entry, i)
        if not is_valid:
            logger.warning(f"[SKIP — MALFORMED] {entry_label}: {reason}")
            malformed += 1
            continue

        title       = entry["Source_Video"].strip()
        script_text = entry["Remixed_Audio_Script"].strip()

        # ── Step 2: Determine voice ────────────────────────────────────────
        # Priority: CLI override > per-entry field > default 'nova'
        voice = (
            voice_override
            or entry.get("Voice", "").strip().lower()
            or "nova"
        )
        if voice not in VALID_VOICES:
            logger.warning(
                f"[VOICE] Unknown voice '{voice}' for {entry_label}. "
                f"Falling back to 'nova'. Valid options: {VALID_VOICES}"
            )
            voice = "nova"

        # ── Step 3: Generate deterministic ID ─────────────────────────────
        video_id = sha256_of(script_text)

        logger.info(
            f"[{entry_label}] Hashing script → video_id: {video_id} | "
            f"voice: {voice} | \"{title[:50]}{'...' if len(title) > 50 else ''}\""
        )

        # ── Step 4: Insert into DB (dedup-safe) ───────────────────────────
        was_inserted = db.insert_video(
            video_id=video_id,
            title=title,
            script_text=script_text,
            voice=voice,
        )

        if was_inserted:
            logger.info(f"  ✅ Queued: {video_id}")
            queued += 1
        else:
            logger.info(f"  ⏭️  Duplicate skipped: {video_id} (script already in DB)")
            skipped += 1

    # ── Final Summary ──────────────────────────────────────────────────────
    print("\n" + "=" * 55)
    print("  AURA-V3 INGESTION COMPLETE")
    print("=" * 55)
    print(f"  Total entries in payload : {len(payload)}")
    print(f"  ✅ Successfully queued   : {queued}")
    print(f"  ⏭️  Duplicates skipped   : {skipped}")
    print(f"  ❌ Malformed / skipped   : {malformed}")
    print("=" * 55)

    if queued > 0:
        print(f"\n  Run `python main.py` to start rendering {queued} video(s).\n")
    else:
        print("\n  Nothing new to render. Queue is up to date.\n")


# ── CLI Entry Point ────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="AURA-V3 Data Ingestion — inject Gemini JSON payload into the pipeline queue."
    )
    parser.add_argument(
        "--file", "-f",
        type=Path,
        default=DEFAULT_PAYLOAD_PATH,
        help=f"Path to the payload JSON file (default: {DEFAULT_PAYLOAD_PATH})"
    )
    parser.add_argument(
        "--voice", "-v",
        type=str,
        default=None,
        choices=list(VALID_VOICES),
        help="Override the TTS voice for ALL entries in this payload batch."
    )
    args = parser.parse_args()

    try:
        ingest(file_path=args.file, voice_override=args.voice)
    except (FileNotFoundError, ValueError, TypeError) as e:
        logger.critical(f"Ingestion aborted: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
