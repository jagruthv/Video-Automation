import os
from pathlib import Path
from dotenv import load_dotenv

# Load from AURA-V2's shared .env (AURA-V3 has no separate .env)
# override=False so a local AURA-V3/.env (if created later) takes precedence
_V2_ENV = Path(__file__).parent.parent / "AURA-V2" / ".env"
if _V2_ENV.exists():
    load_dotenv(_V2_ENV, override=False)
else:
    load_dotenv()  # fallback: search upward from cwd

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR       = Path(__file__).parent
DB_PATH        = BASE_DIR / "data" / "aura_v3.db"
TMP_AUDIO_DIR  = BASE_DIR / "tmp" / "audio"
TMP_RENDER_DIR = BASE_DIR / "tmp" / "renders"
OUTPUT_DIR     = BASE_DIR / "output"                   # Final named MP4s live here
LOG_PATH       = BASE_DIR / "logs" / "pipeline.log"
VAULT_ROOT          = Path(r"d:\Automation\n8n\asmr-qa-vault\public\accepted_vault")
VAULT_DIR           = VAULT_ROOT
KINETIC_SAND_PATH   = Path(r"D:\Automation\n8n\kinetic_sand_vault_1.mp4")  # 3.49 GB 12hr clip
LARGE_CLIP_THRESHOLD_MB = 500   # Files above this are treated as long-form and random-seeked

# ── API Keys ───────────────────────────────────────────────────────────────
POLLINATIONS_BYOP_KEY = os.getenv("POLLINATIONS_BYOP_KEY")
GROQ_API_KEY          = os.getenv("GROQ_API_KEY")
CEREBRAS_API_KEY      = os.getenv("CEREBRAS_API_KEY")
GEMINI_API_KEY        = os.getenv("GEMINI_API_KEY")
CARTESIA_API_KEY      = os.getenv("CARTESIA_API_KEY")
PEXELS_API_KEY        = os.getenv("PEXELS_API_KEY")

# ── Forge Engine Settings ─────────────────────────────────────────────────
# Mapbox Static Images (requires MAPBOX_TOKEN in .env)
MAPBOX_TOKEN          = os.getenv("MAPBOX_TOKEN", "")
MAP_COUNTRY_ZOOM      = 4     # zoom level for country overview tile
MAP_CITY_ZOOM         = 12    # zoom level for city-level tile

# Font assets (used by ui_forge + map_forge fallback)
UI_FONT_PATH          = BASE_DIR / "assets" / "fonts" / "SFProDisplay-Regular.ttf"
UI_FONT_BOLD_PATH     = BASE_DIR / "assets" / "fonts" / "SFProDisplay-Bold.ttf"

# FFmpeg codec defaults shared by all forges
VIDEO_CODEC           = "libx264"
AUDIO_CODEC           = "aac"
CRF                   = 18    # was 20 — 18 = visually lossless, ~15% larger file
PRESET                = "medium"  # was fast — medium = better compression, worth the extra time

# TTS rate-limit backoff (seconds to sleep on HTTP 429)
TTS_BACKOFF_SECS      = 3600

# ── TTS Defaults ──────────────────────────────────────────────────────────
# Active engine: gemini-tts  → gemini-3.1-flash-tts-preview (Google AI Studio key)
# Fallback:      qwen-tts    → Pollinations (uses pollen balance)
#
# Gemini voice names (30 available — see ai.google.dev/gemini-api/docs/speech-generation):
#   Female storytelling:  Aoede (warm, narrative) | Kore | Leda | Zephyr
#   Male authoritative:   Charon (deep, cold)     | Fenrir | Enceladus | Orion
#
# Voice selection is AUTOMATIC via gender detection:
#   MIL/bride stories  → female narrator → Aoede
#   Husband/revenge    → male narrator   → Charon
TTS_VOICE              = "nova"                  # semantic default (mapped to Gemini voice)
TTS_MODEL              = "gemini-tts"            # active engine: gemini-3.1-flash-tts-preview
TTS_TIMEOUT_S          = 300
TTS_SPEED              = 1.0                     # Gemini controls pacing via Director's Notes
TTS_GEMINI_VOICE_FEMALE = "Aoede"               # warm, storytelling — female narrators
TTS_GEMINI_VOICE_MALE   = "Charon"              # deep, authoritative — male narrators

# ── Caption Styling (used by caption_forge) ─────────────────────────────────
CAPTION_WORDS_PER_GROUP  = 3      # 3 words per card = CapCut/TikTok style (was 5)
CAPTION_FONT_SIZE        = 82     # px  (was 78, slightly larger for punch)
CAPTION_Y_POSITION       = int(1920 * 0.74)   # = 1420px — slightly lower (was 1382)
CAPTION_BORDER_W         = 6      # thicker stroke for more contrast (was 5)

# ── FFmpeg ───────────────────────────────────────────────────────────────
FFMPEG_PATH   = os.getenv("FFMPEG_PATH", "ffmpeg")
OUTPUT_WIDTH  = 1080
OUTPUT_HEIGHT = 1920
OUTPUT_FPS    = 30
AUDIO_BITRATE = "192k"    # for AAC audio stream in final output
VIDEO_BITRATE = "4000k"   # for H.264 video stream (compositor.py / remix mode)
VIDEO_SPEED   = 2.0       # background video playback speed multiplier (compositor.py)
WORDS_PER_MINUTE    = 150 # base pace for duration estimation
TARGET_DURATION_MIN =  45 # 0:45 in seconds
TARGET_DURATION_MAX =  55 # 0:55 in seconds (hard ceiling — must stay under 1 min)

# ── Logging ────────────────────────────────────────────────────────────────
LOG_LEVEL = "INFO"   # DEBUG | INFO | WARNING | ERROR

# ── Ensure dirs exist on import ────────────────────────────────────────────
_dirs_to_create = [
    TMP_AUDIO_DIR, TMP_RENDER_DIR, OUTPUT_DIR,
    BASE_DIR / "logs", BASE_DIR / "data",
    BASE_DIR / "assets" / "fonts",
]
# Only attempt to create vault if it's under our own tree or if its parent exists
if VAULT_ROOT.drive and Path(VAULT_ROOT.drive + "\\\\").exists():
    _dirs_to_create.extend([VAULT_ROOT, VAULT_DIR])
for d in _dirs_to_create:
    d.mkdir(parents=True, exist_ok=True)
