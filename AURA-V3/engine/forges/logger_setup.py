"""
engine/forges/logger_setup.py — AURA-V3 Centralized Logging
=============================================================
Single call to `init()` sets up the entire logging stack:

  Console  → Colored, aligned output per log level
  File     → Per-run rotating log with full tracebacks
             Stored in logs/forge_YYYYMMDD_HHMMSS.log

Usage (call ONCE at startup in forge_main.py):

    from engine.forges.logger_setup import init as log_init
    log_init()
"""

import logging
import logging.handlers
import sys
import time
from pathlib import Path

import config

# ─────────────────────────────────────────────
# ANSI COLOR CODES  (Windows 10+ supports these natively)
# ─────────────────────────────────────────────
_RESET  = "\033[0m"
_BOLD   = "\033[1m"
_DIM    = "\033[2m"

_COLORS = {
    "DEBUG"    : "\033[36m",   # cyan
    "INFO"     : "\033[32m",   # green
    "WARNING"  : "\033[33m",   # yellow
    "ERROR"    : "\033[31m",   # red
    "CRITICAL" : "\033[41m",   # red background
}

_LEVEL_WIDTH = 8   # pad level name to this width


class _ColorConsoleFormatter(logging.Formatter):
    """
    Colored, aligned console formatter.

    Example output:
      2026-04-24 12:01:55  INFO      aura.forge.audio    Block 1: TTS attempt 1 ...
      2026-04-24 12:01:58  WARNING   aura.forge.map      Mapbox failed: timeout
      2026-04-24 12:02:01  ERROR     aura.forge.assembly Manim failed — see traceback below
    """

    def format(self, record: logging.LogRecord) -> str:
        color   = _COLORS.get(record.levelname, _RESET)
        level   = f"{color}{_BOLD}{record.levelname:<{_LEVEL_WIDTH}}{_RESET}"
        ts      = self.formatTime(record, "%Y-%m-%d %H:%M:%S")
        name    = f"{_DIM}{record.name:<28}{_RESET}"
        message = record.getMessage()

        line = f"{ts}  {level}  {name}  {message}"

        # Append formatted exception if present
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)

        return line


class _FileFormatter(logging.Formatter):
    """
    Plain-text file formatter — full ISO timestamp, no ANSI codes.
    Includes exc_text for full tracebacks.
    """

    def format(self, record: logging.LogRecord) -> str:
        ts      = self.formatTime(record, "%Y-%m-%dT%H:%M:%S")
        level   = f"{record.levelname:<8}"
        name    = f"{record.name:<30}"
        message = record.getMessage()
        line    = f"{ts}  {level}  {name}  {message}"
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        if record.stack_info:
            line += "\n" + self.formatStack(record.stack_info)
        return line


# ─────────────────────────────────────────────
# PUBLIC INIT
# ─────────────────────────────────────────────

def init(run_tag: str = "") -> Path:
    """
    Configure the root logger and all aura.* loggers.

    Args:
        run_tag: Optional identifier appended to the log filename,
                 e.g. the video title slug.

    Returns:
        Path to the log file created for this run.
    """
    # Enable ANSI escapes on Windows 10+
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleMode(
                ctypes.windll.kernel32.GetStdHandle(-11), 7
            )
        except Exception:
            pass  # Non-fatal — colors just won't show

    log_dir = config.BASE_DIR / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    ts_str    = time.strftime("%Y%m%d_%H%M%S")
    slug      = f"_{run_tag[:30]}" if run_tag else ""
    log_file  = log_dir / f"forge_{ts_str}{slug}.log"

    level = getattr(logging, config.LOG_LEVEL.upper(), logging.INFO)

    # ── Root logger ────────────────────────────────────────────────────────
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)          # capture everything at root
    root.handlers.clear()

    # ── Console handler ────────────────────────────────────────────────────
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(level)
    ch.setFormatter(_ColorConsoleFormatter())
    root.addHandler(ch)

    # ── Rotating file handler (10 MB max, keep 5 backups) ─────────────────
    fh = logging.handlers.RotatingFileHandler(
        str(log_file),
        maxBytes   = 10 * 1024 * 1024,
        backupCount= 5,
        encoding   = "utf-8",
    )
    fh.setLevel(logging.DEBUG)   # file always gets DEBUG and above
    fh.setFormatter(_FileFormatter())
    root.addHandler(fh)

    # Silence noisy third-party libs
    for noisy in ["PIL", "urllib3", "httpx", "httpcore", "manim"]:
        logging.getLogger(noisy).setLevel(logging.WARNING)

    logging.getLogger("aura").info(
        f"Logging initialized -> console ({config.LOG_LEVEL}) + file: {log_file.name}"
    )

    return log_file
