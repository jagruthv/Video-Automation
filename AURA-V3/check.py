import sys
sys.path.insert(0, ".")

import ast, pathlib, subprocess

files = [
    "api.py", "main.py", "config.py", "ingest.py",
    "engine/db.py", "engine/compositor.py",
    "engine/audio.py", "engine/vault.py", "engine/script_guard.py",
]

print("=== SYNTAX CHECK ===")
all_ok = True
for f in files:
    try:
        ast.parse(pathlib.Path(f).read_text(encoding="utf-8"))
        print(f"  OK  {f}")
    except SyntaxError as e:
        print(f"  ERR {f}: {e}")
        all_ok = False

print()
print("=== ENV + CONFIG CHECK ===")
from config import (
    POLLINATIONS_BYOP_KEY, GROQ_API_KEY, FFMPEG_PATH,
    TTS_SPEED, VIDEO_SPEED, TARGET_DURATION_MAX,
    VAULT_ROOT, VAULT_DIR, KINETIC_SAND_PATH, OUTPUT_DIR,
    WORDS_PER_MINUTE,
)

def masked(key):
    return f"SET ({key[:8]}...)" if key else "MISSING"

print(f"  POLLINATIONS_BYOP_KEY : {masked(POLLINATIONS_BYOP_KEY)}")
print(f"  GROQ_API_KEY          : {masked(GROQ_API_KEY)}")
print(f"  FFMPEG_PATH           : {FFMPEG_PATH}")
print(f"  TTS_SPEED             : {TTS_SPEED}x")
print(f"  VIDEO_SPEED           : {VIDEO_SPEED}x")
print(f"  TARGET_DURATION_MAX   : {TARGET_DURATION_MAX}s  ({TARGET_DURATION_MAX//60}:{TARGET_DURATION_MAX%60:02d})")
print(f"  VAULT_ROOT exists     : {VAULT_ROOT.exists()}")
print(f"  VAULT_DIR exists      : {VAULT_DIR.exists()}")
print(f"  KINETIC_SAND exists   : {KINETIC_SAND_PATH.exists()}  ({KINETIC_SAND_PATH.name})")
print(f"  OUTPUT_DIR exists     : {OUTPUT_DIR.exists()}")

print()
print("=== FFMPEG CHECK ===")
from engine.compositor import FFPROBE_PATH, _SETPTS_FACTOR
print(f"  FFPROBE_PATH          : {FFPROBE_PATH}")
print(f"  setpts factor         : {_SETPTS_FACTOR}*PTS  (VIDEO_SPEED={VIDEO_SPEED}x)")

r = subprocess.run([FFMPEG_PATH, "-version"], capture_output=True, text=True)
line = r.stdout.splitlines()[0] if r.stdout else r.stderr[:80]
print(f"  ffmpeg available      : {'YES — ' + line if r.returncode == 0 else 'NO — ' + line}")

r2 = subprocess.run([FFPROBE_PATH, "-version"], capture_output=True, text=True)
line2 = r2.stdout.splitlines()[0] if r2.stdout else r2.stderr[:80]
print(f"  ffprobe available     : {'YES — ' + line2 if r2.returncode == 0 else 'NO — ' + line2}")

print()
print("=== SCRIPT GUARD MATH ===")
from engine.script_guard import MAX_WORDS, SOFT_TARGET, HARD_TARGET, _estimate, _fmt
print(f"  MAX_WORDS  (hard 3:00): {MAX_WORDS} words -> {_fmt(_estimate(MAX_WORDS))}")
print(f"  SOFT_TARGET (pass 1)  : {SOFT_TARGET} words -> {_fmt(_estimate(SOFT_TARGET))}")
print(f"  HARD_TARGET (pass 2)  : {HARD_TARGET} words -> {_fmt(_estimate(HARD_TARGET))}")

print()
print("=== VAULT CHECK ===")
from engine.vault import VaultManager, _FFPROBE
vm = VaultManager()
small = vm._collect_small_clips()
print(f"  Small clips found     : {len(small)}")
print(f"  Kinetic sand ready    : {KINETIC_SAND_PATH.exists()}")
print(f"  Vault _FFPROBE        : {_FFPROBE}")

print()
print("ALL OK" if all_ok else "SYNTAX ERRORS FOUND — fix before running")
