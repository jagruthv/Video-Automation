"""
preflight.py -- AURA-V3 Pre-flight System Check
================================================
Validates the entire environment BEFORE making any API calls.
Run: python preflight.py

Checks:
  1. FFmpeg/ffprobe available + version
  2. FFmpeg supports required filters (drawtext, zoompan, overlay)
  3. Python packages installed (pydantic, pillow, python-dotenv)
  4. Manim installation status
  5. Vault directory contents
  6. Font files status
  7. Caption drawtext chain with real test text (dry-run)
  8. Temp/output directories writable
  9. Config sanity
 10. .env file / API keys loaded
"""

import sys
import subprocess
import shutil
from pathlib import Path

# Force UTF-8 output on Windows so box-drawing chars don't crash cp1252
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, r"D:\Automation\AURA-V3")

WARN  = "[WARN ]"
OK    = "[ OK  ]"
FAIL  = "[FAIL ]"
INFO  = "[INFO ]"

issues   = []   # blockers — pipeline will crash
warnings = []   # non-fatal — pipeline degrades gracefully

def section(title):
    print(f"\n" + "-"*55)
    print(f"  {title}")
    print("-"*55)

# ---------------------------------------------
# 1. FFmpeg / ffprobe
# ---------------------------------------------
section("1. FFmpeg & ffprobe")

for tool in ["ffmpeg", "ffprobe"]:
    path = shutil.which(tool)
    if path:
        r = subprocess.run([tool, "-version"], capture_output=True, text=True)
        ver = r.stdout.split("\n")[0]
        print(f"{OK} {tool}: {ver[:70]}")
    else:
        print(f"{FAIL} {tool}: NOT FOUND on PATH")
        issues.append(f"{tool} not on PATH")

# ─────────────────────────────────────────────
# 2. FFmpeg filter support
# ─────────────────────────────────────────────
section("2. FFmpeg filter availability")

required_filters = ["drawtext", "zoompan", "overlay", "fade", "scale", "pad", "format"]
r = subprocess.run(["ffmpeg", "-filters"], capture_output=True, text=True, timeout=15)
filter_list = r.stdout + r.stderr

for f in required_filters:
    if f in filter_list:
        print(f"{OK} filter: {f}")
    else:
        print(f"{FAIL} filter: {f} — NOT in FFmpeg build")
        issues.append(f"FFmpeg missing filter: {f}")

# Test drawtext with a Windows font path
section("2b. Drawtext quick-render test (1x1 black frame)")
test_out = Path(r"D:\Automation\AURA-V3\tmp\renders\preflight_drawtext.mp4")
test_out.parent.mkdir(parents=True, exist_ok=True)

# Find a real font
import os
font_candidates = [
    r"D:\Automation\AURA-V3\assets\fonts\SFProDisplay-Bold.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]
found_font = next((p for p in font_candidates if Path(p).exists()), None)

if found_font:
    ffmpeg_font = found_font.replace("\\", "/")
    if len(ffmpeg_font) >= 2 and ffmpeg_font[1] == ":":
        ffmpeg_font = ffmpeg_font[0] + "\\:" + ffmpeg_font[2:]
    dt_filter = (
        f"drawtext=text='TEST CAPTION':fontfile='{ffmpeg_font}':"
        f"fontsize=40:fontcolor=white:borderw=3:bordercolor=black:"
        f"x=(w-text_w)/2:y=h/2"
    )
else:
    dt_filter = (
        "drawtext=text='TEST CAPTION':fontsize=40:fontcolor=white:"
        "borderw=3:bordercolor=black:x=(w-text_w)/2:y=h/2"
    )

r = subprocess.run([
    "ffmpeg", "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=black:s=64x64:r=1:d=1",
    "-vf", dt_filter,
    "-c:v", "libx264", "-t", "1",
    str(test_out),
], capture_output=True, text=True, timeout=30)

if r.returncode == 0 and test_out.exists():
    print(f"{OK} drawtext render: success ({test_out.stat().st_size} bytes)")
    test_out.unlink()
else:
    print(f"{FAIL} drawtext render FAILED:\n     {r.stderr.strip()[-500:]}")
    issues.append("drawtext test render failed — captions will not work")

# ─────────────────────────────────────────────
# 3. Python packages
# ─────────────────────────────────────────────
section("3. Python packages")

packages = {
    "pydantic"     : "pydantic",
    "PIL"          : "Pillow",
    "dotenv"       : "python-dotenv",
    "requests"     : "requests",
}

for module, pip_name in packages.items():
    try:
        __import__(module)
        import importlib.metadata
        try:
            ver = importlib.metadata.version(pip_name)
        except Exception:
            ver = "installed"
        print(f"{OK} {pip_name}: {ver}")
    except ImportError:
        print(f"{FAIL} {pip_name}: NOT installed  (pip install {pip_name})")
        issues.append(f"Missing package: {pip_name}")

# Manim is optional (only needed for Manim_* engine blocks)
try:
    import manim
    print(f"{OK} manim: {manim.__version__}")
    manim_ok = True
except ImportError:
    print(f"{WARN} manim: NOT installed — Manim_Legal_Doc and Manim_Flowchart blocks will FAIL")
    print(f"       Install: pip install manim")
    warnings.append("manim not installed — Manim engine blocks unavailable")
    manim_ok = False

# ─────────────────────────────────────────────
# 4. Vault directory contents
# ─────────────────────────────────────────────
section("4. Vault directory")

import config

vault = config.VAULT_DIR
extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

if vault.exists():
    clips = [f for f in vault.iterdir()
             if f.suffix.lower() in extensions and f.stat().st_size > 10_000]
    print(f"{OK} vault path exists: {vault}")
    if clips:
        total_mb = sum(c.stat().st_size for c in clips) / 1_048_576
        print(f"{OK} vault clips found: {len(clips)} files ({total_mb:.0f} MB total)")
        for c in clips[:5]:
            print(f"       • {c.name}  ({c.stat().st_size//1024} KB)")
        if len(clips) > 5:
            print(f"       ... and {len(clips)-5} more")
    else:
        print(f"{WARN} vault exists but has NO video clips")
        warnings.append("Vault is empty — Background_Vault will try kinetic sand fallback")
else:
    print(f"{WARN} vault directory does not exist: {vault}")
    warnings.append("Vault directory missing — Background_Vault will use kinetic sand fallback")

# Kinetic sand fallback
ks = config.KINETIC_SAND_PATH
if ks.exists():
    ks_mb = ks.stat().st_size / 1_048_576
    print(f"{OK} kinetic sand fallback: {ks.name} ({ks_mb:.0f} MB)")
else:
    print(f"{WARN} kinetic sand fallback NOT found: {ks}")
    warnings.append("KINETIC_SAND_PATH missing — if vault is empty, black frame will be used")

# ─────────────────────────────────────────────
# 5. Font files
# ─────────────────────────────────────────────
section("5. Font files")

for label, path in [
    ("Custom bold (UI_FONT_BOLD_PATH)", config.UI_FONT_BOLD_PATH),
    ("Custom regular (UI_FONT_PATH)",   config.UI_FONT_PATH),
    ("Windows Arial Bold",              Path(r"C:\Windows\Fonts\arialbd.ttf")),
    ("Windows Arial Regular",           Path(r"C:\Windows\Fonts\arial.ttf")),
]:
    if Path(path).exists():
        print(f"{OK} {label}: {Path(path).name}")
    else:
        print(f"{WARN} {label}: not found ({path})")

if found_font:
    print(f"\n{INFO} Caption forge will use: {Path(found_font).name}")
else:
    print(f"\n{WARN} No TTF font found — FFmpeg will use built-in default (low quality)")
    warnings.append("No TTF font found for captions")

# ─────────────────────────────────────────────
# 6. Caption escaping dry-run
# ─────────────────────────────────────────────
section("6. Caption escaping dry-run")

from engine.forges.caption_forge import _word_groups, _build_drawtext_chain, _resolve_font, _esc

test_narrations = [
    "In 2014, an arrogant billionaire hedge fund manager fired his entire cybersecurity team to save two million dollars.",
    "My power-tripping HOA president tried to foreclose on my house over a $500 fine for my work truck.",
    "It's a 50% deal: buy now \\ rush hour",
]

font = _resolve_font()
all_ok = True
for narr in test_narrations:
    try:
        groups = _word_groups(narr, 15.0)
        chain  = _build_drawtext_chain(groups, font)
        # Quick sanity: chain must not have unescaped single quotes
        # (every ' in user text should be \' in the chain)
        assert "drawtext=" in chain
        print(f"{OK} {len(groups)} groups | text: {narr[:55]}...")
    except Exception as exc:
        print(f"{FAIL} Escaping failed: {exc}\n       text: {narr[:55]}...")
        issues.append(f"Caption escaping failed for: {narr[:40]}")
        all_ok = False

if all_ok:
    print(f"{OK} All caption chains built cleanly")

# ─────────────────────────────────────────────
# 7. Writable directories
# ─────────────────────────────────────────────
section("7. Directory write permissions")

for label, path in [
    ("TMP_AUDIO_DIR",  config.TMP_AUDIO_DIR),
    ("TMP_RENDER_DIR", config.TMP_RENDER_DIR),
    ("OUTPUT_DIR",     config.OUTPUT_DIR),
    ("LOG dir",        config.BASE_DIR / "logs"),
]:
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    probe = path / "__write_test__"
    try:
        probe.write_text("ok")
        probe.unlink()
        print(f"{OK} {label}: {path}")
    except Exception as exc:
        print(f"{FAIL} {label}: NOT writable — {exc}")
        issues.append(f"Directory not writable: {path}")

# ─────────────────────────────────────────────
# 8. Config sanity
# ─────────────────────────────────────────────
section("8. Config & .env")

print(f"{INFO} TTS_VOICE  = {config.TTS_VOICE!r}")
print(f"{INFO} TTS_MODEL  = {config.TTS_MODEL!r}")
print(f"{INFO} TTS_SPEED  = {config.TTS_SPEED}x")
print(f"{INFO} OUTPUT     = {config.OUTPUT_WIDTH}x{config.OUTPUT_HEIGHT} @ {config.OUTPUT_FPS}fps")
print(f"{INFO} VIDEO_CODEC= {config.VIDEO_CODEC}  CRF={config.CRF}  PRESET={config.PRESET}")

if config.MAPBOX_TOKEN:
    print(f"{OK} MAPBOX_TOKEN: set ({len(config.MAPBOX_TOKEN)} chars)")
else:
    print(f"{WARN} MAPBOX_TOKEN: not set — Map_Engine will use OSM fallback")
    warnings.append("MAPBOX_TOKEN not set — map blocks use OSM tiles")

# Check Pollinations reachability (just DNS, no credit cost)
import urllib.request
try:
    req = urllib.request.Request(
        "https://text.pollinations.ai/",
        headers={"User-Agent": "AURA-V3-preflight/1.0"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        print(f"{OK} Pollinations TTS endpoint: reachable (status {r.status})")
except Exception as exc:
    print(f"{WARN} Pollinations TTS endpoint: unreachable — {exc}")
    warnings.append(f"Pollinations TTS unreachable: {exc}")

# ─────────────────────────────────────────────
# FINAL REPORT
# ─────────────────────────────────────────────
section("FINAL PRE-FLIGHT REPORT")

if issues:
    print(f"\n  BLOCKERS ({len(issues)}) — fix before running pipeline:")
    for i in issues:
        print(f"  ✗  {i}")
else:
    print(f"\n  NO BLOCKERS — pipeline is safe to run")

if warnings:
    print(f"\n  WARNINGS ({len(warnings)}) — non-fatal, will degrade gracefully:")
    for w in warnings:
        print(f"  ⚠  {w}")

if not manim_ok:
    print(f"\n  NOTE: Remove Manim blocks from your test script before running,")
    print(f"        or install manim first:  pip install manim")

print()
if issues:
    print("  ❌  PRE-FLIGHT FAILED — do NOT run the pipeline yet")
    sys.exit(1)
else:
    print("  ✅  PRE-FLIGHT PASSED — pipeline ready to run")
    sys.exit(0)
