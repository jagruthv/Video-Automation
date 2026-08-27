import sqlite3
import logging
from pathlib import Path
from config import DB_PATH

logger = logging.getLogger("aura.db")


class DatabaseTracker:
    """Thread-safe SQLite ORM wrapper for the AURA-V3 pipeline queue."""

    def __init__(self, db_path: Path = DB_PATH, recover: bool = False):
        self.db_path = db_path
        self._init_schema()
        if recover:
            self.reset_stale_rendering()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self):
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS videos (
                    video_id              TEXT PRIMARY KEY,
                    title                 TEXT NOT NULL,
                    script_text           TEXT NOT NULL,
                    voice                 TEXT DEFAULT 'nova',
                    mode                  TEXT DEFAULT 'standard',
                    topic_tags            TEXT,
                    source_clip           TEXT,
                    audio_path            TEXT,
                    audio_chunk_1_path    TEXT,
                    audio_remaining_script TEXT,
                    output_path           TEXT,
                    generation_status     TEXT DEFAULT 'pending',
                    error_message         TEXT,
                    yt_title              TEXT,
                    description           TEXT,
                    tags                  TEXT,
                    thumbnail_path        TEXT,
                    part_2_script         TEXT,
                    part_3_script         TEXT,
                    part_2_status         TEXT DEFAULT 'waiting',
                    part_3_status         TEXT DEFAULT 'waiting',
                    part_2_audio_path     TEXT,
                    part_3_audio_path     TEXT,
                    part_2_output_path    TEXT,
                    part_3_output_path    TEXT,
                    created_at            TEXT DEFAULT (datetime('now')),
                    upload_time           TEXT
                )
            """)
            for col, definition in [
                ("audio_chunk_1_path",     "TEXT"),
                ("audio_remaining_script", "TEXT"),
                ("yt_title",               "TEXT"),
                ("description",            "TEXT"),
                ("tags",                   "TEXT"),
                ("thumbnail_path",         "TEXT"),
                ("part_2_script",          "TEXT"),
                ("part_3_script",          "TEXT"),
                ("part_2_status",          "TEXT DEFAULT 'waiting'"),
                ("part_3_status",          "TEXT DEFAULT 'waiting'"),
                ("part_2_audio_path",      "TEXT"),
                ("part_3_audio_path",      "TEXT"),
                ("part_2_output_path",     "TEXT"),
                ("part_3_output_path",     "TEXT"),
                ("mode",                   "TEXT DEFAULT 'standard'"),
                ("topic_tags",             "TEXT"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE videos ADD COLUMN {col} {definition}")
                except sqlite3.OperationalError:
                    pass  # Column already exists — fine

        logger.info("Database schema verified.")

    # ── Writes ──────────────────────────────────────────────────────────────

    def insert_video(self, video_id: str, title: str, script_text: str,
                     voice: str = "nova", mode: str = "standard", topic_tags: list = None) -> bool:
        """Insert a new pending video. Returns False if video_id already exists (duplicate)."""
        import json as _json
        try:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO videos (video_id, title, script_text, voice, mode, topic_tags) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (video_id, title, script_text, voice, mode, _json.dumps(topic_tags or []))
                )
            logger.info(f"[DB] Inserted: {video_id} (mode={mode})")
            return True
        except sqlite3.IntegrityError:
            logger.warning(f"[DB] Duplicate skipped: {video_id}")
            return False

    def update_status(self, video_id: str, status: str, **kwargs):
        """Update generation_status and any additional columns (audio_path, output_path, etc.)."""
        fields = {"generation_status": status, **kwargs}
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [video_id]
        with self._connect() as conn:
            conn.execute(f"UPDATE videos SET {set_clause} WHERE video_id = ?", values)
        logger.info(f"[DB] {video_id} -> {status}")

    def save_partial_audio(self, video_id: str, chunk1_path: Path, remaining_script: str):
        """
        Called when BYOP balance is exhausted after generating chunk 1.
        Sets status = 'audio_partial' — the pipeline will resume here when pollen is topped up.
        """
        with self._connect() as conn:
            conn.execute(
                "UPDATE videos SET generation_status='audio_partial', "
                "audio_chunk_1_path=?, audio_remaining_script=? WHERE video_id=?",
                (str(chunk1_path), remaining_script, video_id)
            )
        logger.info(f"[DB] {video_id} -> audio_partial  chunk1={chunk1_path.name}")

    def save_metadata(self, video_id: str, yt_title: str, description: str,
                      tags: list, thumbnail_path: str | None):
        """Store Gemini-generated YouTube metadata after a successful render."""
        import json as _json
        with self._connect() as conn:
            conn.execute(
                "UPDATE videos SET yt_title=?, description=?, tags=?, thumbnail_path=? "
                "WHERE video_id=?",
                (yt_title, description, _json.dumps(tags), thumbnail_path, video_id)
            )
        logger.info(f"[DB] {video_id} metadata saved (title={yt_title[:40]!r})")


    def reset_to_pending(self, video_id: str):
        """Reset an error/partial video back to pending so it can be retried cleanly."""
        with self._connect() as conn:
            conn.execute(
                "UPDATE videos SET generation_status='pending', error_message=NULL, "
                "audio_chunk_1_path=NULL "
                "WHERE video_id=?",
                (video_id,)
            )
        logger.info(f"[DB] {video_id} -> pending (manual retry reset)")

    # ── Reads ───────────────────────────────────────────────────────────────

    def get_pending(self) -> list:
        """Returns all videos that are ready to render (new or resumable)."""
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM videos "
                "WHERE generation_status IN ('pending', 'audio_partial') "
                "ORDER BY created_at ASC"
            ).fetchall()

    def reset_stale_rendering(self) -> int:
        """Reset any video stuck in 'rendering' (from a crash) back to 'pending'."""
        with self._connect() as conn:
            result = conn.execute(
                "UPDATE videos SET generation_status = 'pending', error_message = NULL "
                "WHERE generation_status = 'rendering'"
            )
            count = result.rowcount
        if count:
            logger.warning(f"[DB] Recovered {count} stale 'rendering' row(s) -> 'pending'")
        return count

    def exists(self, video_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM videos WHERE video_id = ?", (video_id,)
            ).fetchone()
        return row is not None

    def get_video(self, video_id: str):
        """Fetch a single video row by ID. Returns sqlite3.Row or None."""
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM videos WHERE video_id = ?", (video_id,)
            ).fetchone()

    def transfer_to_v2_registry(self, video_id: str) -> bool:
        """
        Step 11: Remove from this database and send it to memory registry
        Connects via HTTP to AURA-V2's Node server to ensure sql.js memory is seamlessly
        synced without SQLite file locking exceptions or overwrites.
        """
        row = self.get_video(video_id)
        if not row: return False

        import json
        import urllib.request
        meta = {}
        try:
            if row["tags"]: meta = {"tags": json.loads(row["tags"])}
        except: pass

        title = row["yt_title"] or row["title"]
        desc  = row["description"] or ""
        out_path = str(row["output_path"] or "").replace("\\", "/")
        thumb_path = str(row["thumbnail_path"] or "").replace("\\", "/")

        payload = {
            "title": title,
            "description": desc,
            "file_path": out_path,
            "thumbnail": thumb_path,
            "metadata": json.dumps(meta)
        }
        
        try:
            req = urllib.request.Request(
                "http://localhost:3001/api/library/import",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                res = json.loads(r.read())
                if not res.get("success"):
                    logger.error(f"[DB] Transfer to V2 API failed: {res.get('error')}")
                    return False
        except Exception as e:
            logger.error(f"[DB] Fatal error reaching AURA-V2 Node Server: {e}")
            return False

        logger.info(f"[DB] Successfully transferred {video_id} to AURA-V2 Memory Registry.")

        # Remove from local V3 DB exactly as requested
        try:
            with self._connect() as conn:
                conn.execute("DELETE FROM videos WHERE video_id = ?", (video_id,))
            logger.info(f"[DB] Removed {video_id} from AURA-V3 database.")
            return True
        except Exception as e:
            logger.error(f"[DB] Failed to remove from local V3 DB: {e}")
            return False
