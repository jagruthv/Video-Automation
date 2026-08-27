"""
AURA Remix Engine — Stdlib HTTP Bridge Server
Runs on port 8001. Zero dependencies — uses only Python built-ins.
Start with: python api.py
"""

# Force UTF-8 on Windows terminals (CP1252 can't encode emoji/arrows in log msgs)
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import hashlib
import importlib.util
import json
import logging
import logging.handlers
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# ── Bootstrap path so engine.* imports work regardless of cwd ──────────────
sys.path.insert(0, str(Path(__file__).parent))

from config import LOG_PATH
from engine.db import DatabaseTracker

# ── Logging ────────────────────────────────────────────────────────────────
_log_handler = logging.handlers.RotatingFileHandler(
    LOG_PATH, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[_log_handler, logging.StreamHandler()],
)
logger = logging.getLogger("aura.api")

# ── Globals ────────────────────────────────────────────────────────────────
db           = DatabaseTracker(recover=True)   # recover=True runs stale-rendering reset once at startup
_rendering: set[str] = set()
_render_lock = threading.Lock()
# Valid voices for Qwen3-TTS Flash (qwen-tts) — ElevenLabs-only voices (adam/george/bella/etc) are INVALID
VALID_VOICES = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}

PORT = 8001


# ── Helpers ────────────────────────────────────────────────────────────────

def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _is_malformed(script: str, title: str) -> bool:
    s = script.strip()
    return not title.strip() or s.startswith("[") or len(s) < 50


def _load_pipeline():
    """Import main.py as a module (cached across calls within the same session)."""
    spec = importlib.util.spec_from_file_location(
        "aura_main", Path(__file__).parent / "main.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot locate main.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)   # type: ignore[attr-defined]
    return mod


def _run_single(video_id: str):
    # Fetch the FULL row first (before status change) to preserve
    # audio_chunk_1_path / audio_remaining_script for resume mode
    with db._connect() as conn:
        original_row = conn.execute(
            "SELECT * FROM videos WHERE video_id = ?", (video_id,)
        ).fetchone()

    db.update_status(video_id, "rendering")
    try:
        mod = _load_pipeline()
        if original_row:
            mod.run_pipeline(original_row)
    except Exception as exc:
        logger.error(f"[PIPELINE] Crash for {video_id}: {exc}", exc_info=True)
        try:
            db.update_status(video_id, "error", error_message=str(exc)[:500])
        except Exception:
            pass
    finally:
        with _render_lock:
            _rendering.discard(video_id)


def _run_all(video_ids: list[str]):
    try:
        mod = _load_pipeline()
        for vid in video_ids:
            try:
                db.update_status(vid, "rendering")
                with db._connect() as conn:
                    row = conn.execute(
                        "SELECT * FROM videos WHERE video_id = ?", (vid,)
                    ).fetchone()
                if row:
                    mod.run_pipeline(row)
            except Exception as exc:
                logger.error(f"[PIPELINE] Crash for {vid}: {exc}", exc_info=True)
                try:
                    db.update_status(vid, "error", error_message=str(exc)[:500])
                except Exception:
                    pass
            finally:
                with _render_lock:
                    _rendering.discard(vid)
    except Exception as exc:
        logger.error(f"[PIPELINE] Fatal in _run_all: {exc}", exc_info=True)
        with _render_lock:
            for vid in video_ids:
                _rendering.discard(vid)


# ── HTTP Handler ───────────────────────────────────────────────────────────

class AURAHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        msg = fmt % args
        if "GET /api/queue" in msg:
            return
        logger.info("HTTP %s", msg)

    # ── Response helpers ────────────────────────────────────────────────────

    def _send_json(self, data, status=200):
        body = json.dumps(data, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        return json.loads(raw) if raw else {}

    def _error(self, status, msg):
        self._send_json({"error": msg}, status)

    # ── CORS preflight ──────────────────────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ── GET ─────────────────────────────────────────────────────────────────

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path.rstrip("/")
        qs     = parse_qs(parsed.query)

        # GET /api/health
        if path == "/api/health":
            self._send_json({"status": "online", "service": "AURA Remix Engine"})

        # GET /api/queue[?status=...]
        elif path == "/api/queue":
            status_filter = qs.get("status", [None])[0]
            with db._connect() as conn:
                if status_filter:
                    rows = conn.execute(
                        "SELECT video_id, title, voice, generation_status, error_message, "
                        "created_at, output_path, source_clip, audio_path, "
                        "part_2_status, part_3_status, part_2_audio_path, part_3_audio_path "
                        "FROM videos WHERE generation_status = ? ORDER BY created_at DESC",
                        (status_filter,)
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT video_id, title, voice, generation_status, error_message, "
                        "created_at, output_path, source_clip, audio_path, "
                        "part_2_status, part_3_status, part_2_audio_path, part_3_audio_path "
                        "FROM videos ORDER BY created_at DESC"
                    ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                d["output_filename"] = Path(d["output_path"]).name if d.get("output_path") else None
                result.append(d)
            self._send_json({"total": len(result), "videos": result})

        # GET /api/rendered
        elif path == "/api/rendered":
            with db._connect() as conn:
                rows = conn.execute(
                    "SELECT video_id, title, voice, output_path, created_at "
                    "FROM videos WHERE generation_status = 'rendered' "
                    "ORDER BY created_at DESC"
                ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                if d.get("output_path") and Path(d["output_path"]).exists():
                    p = Path(d["output_path"])
                    d["output_filename"] = p.name
                    d["file_size_mb"] = round(p.stat().st_size / 1024 / 1024, 1)
                else:
                    d["output_filename"] = None
                    d["file_size_mb"] = None
                result.append(d)
            self._send_json({"total": len(result), "videos": result})

        # GET /api/status/<video_id>
        elif path.startswith("/api/status/"):
            video_id = path.split("/api/status/", 1)[1]
            with db._connect() as conn:
                row = conn.execute(
                    "SELECT * FROM videos WHERE video_id = ?", (video_id,)
                ).fetchone()
            if not row:
                self._error(404, "Video not found")
            else:
                self._send_json(dict(row))

        else:
            self._error(404, f"Unknown route: {path}")

    # ── POST ────────────────────────────────────────────────────────────────

    def do_POST(self):
        parsed = urlparse(self.path)
        path   = parsed.path.rstrip("/")

        # POST /api/ingest
        if path == "/api/ingest":
            try:
                entries = self._read_json()
                if not isinstance(entries, list):
                    self._error(400, "Expected a JSON array")
                    return
            except Exception:
                self._error(400, "Invalid JSON")
                return

            queued = skipped = malformed = 0
            details = []

            for entry in entries:
                title  = (entry.get("Source_Video") or "").strip()
                script = (entry.get("Remixed_Audio_Script") or "").strip()

                if _is_malformed(script, title):
                    malformed += 1
                    details.append({"id": entry.get("ID"), "status": "malformed"})
                    continue

                voice = (entry.get("Voice") or "nova").strip().lower()
                if voice not in VALID_VOICES:
                    voice = "nova"

                video_id = _sha256(script)
                inserted = db.insert_video(
                    video_id=video_id, title=title,
                    script_text=script, voice=voice
                )
                if inserted:
                    queued += 1
                    details.append({
                        "id": entry.get("ID"), "video_id": video_id,
                        "status": "queued", "title": title[:60]
                    })
                else:
                    skipped += 1
                    details.append({
                        "id": entry.get("ID"), "video_id": video_id,
                        "status": "duplicate"
                    })

            self._send_json({"queued": queued, "skipped": skipped,
                             "malformed": malformed, "details": details})

        # POST /ingest  — single Mode 8 video from V2 server
        elif path == "/ingest":
            try:
                body = self._read_json()
            except Exception:
                self._error(400, "Invalid JSON"); return

            title  = (body.get("title") or body.get("topic") or "").strip()
            script = (body.get("script") or "").strip()
            voice  = (body.get("voice") or "nova").strip().lower()
            mode   = (body.get("mode") or "standard").strip()

            if not title:
                self._error(400, "title is required"); return

            # For Mode 8 without a script, generate a placeholder so TTS can run
            if not script:
                script = f"Story about: {title}. This content will be auto-generated."

            if voice not in VALID_VOICES:
                voice = "nova"

            video_id = _sha256(title + script)
            inserted = db.insert_video(
                video_id=video_id, title=title,
                script_text=script, voice=voice, mode=mode
            )

            if inserted:
                # Auto-start render in background
                with _render_lock:
                    _rendering.add(video_id)
                threading.Thread(target=_run_single, args=(video_id,), daemon=True).start()
                logger.info(f"[INGEST] Mode {mode} video queued+started: {video_id} | {title[:50]}")
                self._send_json({"success": True, "video_id": video_id,
                                 "message": f"Mode {mode} video queued and rendering."})
            else:
                self._send_json({"success": False, "video_id": video_id,
                                 "message": "Duplicate — already in queue."})

        # POST /api/render  — render all pending
        elif path == "/api/render":
            with db._connect() as conn:
                pending_rows = conn.execute(
                    "SELECT video_id FROM videos WHERE generation_status = 'pending'"
                ).fetchall()
            pending_ids = [r["video_id"] for r in pending_rows]

            with _render_lock:
                to_run = [v for v in pending_ids if v not in _rendering]
                for v in to_run:
                    _rendering.add(v)

            if not to_run:
                self._send_json({"message": "No pending videos — queue empty or all rendering."})
                return

            threading.Thread(target=_run_all, args=(to_run,), daemon=True).start()
            self._send_json({"message": f"Render started for {len(to_run)} video(s)."})

        # POST /api/render/single  — render one video_id
        elif path == "/api/render/single":
            try:
                body = self._read_json()
            except Exception:
                self._error(400, "Invalid JSON")
                return

            video_id = (body.get("video_id") or "").strip()
            if not video_id:
                self._error(400, "video_id is required")
                return
            if not db.exists(video_id):
                self._error(404, f"video_id {video_id} not found")
                return

            with _render_lock:
                if video_id in _rendering:
                    self._send_json({"message": f"{video_id} is already rendering."})
                    return
                _rendering.add(video_id)

            threading.Thread(target=_run_single, args=(video_id,), daemon=True).start()
            self._send_json({"message": f"Render started for {video_id}"})

        # POST /api/reset/<video_id>  — reset error/partial to pending (Retry button)
        elif path.startswith("/api/reset/"):
            video_id = path.split("/api/reset/", 1)[1].strip()
            if not video_id:
                self._error(400, "video_id is required in URL path")
                return
            if not db.exists(video_id):
                self._error(404, f"video_id {video_id} not found")
                return
            with _render_lock:
                if video_id in _rendering:
                    self._send_json({"message": f"{video_id} is currently rendering — cannot reset."})
                    return
            db.reset_to_pending(video_id)
            # Clear cached balance check so next attempt re-probes credits
            try:
                from engine.balance import invalidate_cache
                invalidate_cache()
            except Exception:
                pass
            self._send_json({"reset": video_id, "status": "pending"})



        # POST /api/transfer  — fallback to manually push rendered video to AURA-V2
        elif path == "/api/transfer":
            try:
                body = self._read_json()
            except Exception:
                self._error(400, "Invalid JSON"); return
            
            video_id = (body.get("video_id") or "").strip()
            if not video_id:
                self._error(400, "video_id is required"); return
            if not db.exists(video_id):
                self._error(404, f"video_id {video_id} not found"); return
            
            success = db.transfer_to_v2_registry(video_id)
            if success:
                self._send_json({"message": "Successfully transferred to AURA-V2 Memory Registry."})
            else:
                self._error(500, "Failed to reach AURA-V2 Node Server or video missing.")

        else:
            self._error(404, f"Unknown route: {path}")



    # ── DELETE ──────────────────────────────────────────────────────────────

    def do_DELETE(self):
        path = urlparse(self.path).path.rstrip("/")

        if path.startswith("/api/queue/"):
            video_id = path.split("/api/queue/", 1)[1]

            with _render_lock:
                if video_id in _rendering:
                    self._error(409, "Cannot delete: video is currently rendering.")
                    return

            with db._connect() as conn:
                row = conn.execute(
                    "SELECT generation_status FROM videos WHERE video_id = ?",
                    (video_id,)
                ).fetchone()
                if not row:
                    self._error(404, "Not found")
                    return
                if row["generation_status"] == "rendered":
                    self._error(409, "Cannot delete: already rendered. Move to archive first.")
                    return
                conn.execute("DELETE FROM videos WHERE video_id = ?", (video_id,))

            self._send_json({"deleted": video_id})
        else:
            self._error(404, f"Unknown route: {path}")


# ── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), AURAHandler)
    logger.info("========================================")
    logger.info(f"AURA Remix Engine ONLINE (Port {PORT})")
    logger.info(f"Health: http://localhost:{PORT}/api/health")
    logger.info("========================================")
    print(f"\n========================================")
    print(f"AURA Remix Engine ONLINE (Port {PORT})")
    print(f"Health: http://localhost:{PORT}/api/health")
    print(f"========================================\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Remix Engine shutting down.")
        server.shutdown()
