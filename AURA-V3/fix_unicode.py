"""
fix_unicode.py -- Scan all forge .py files for non-ASCII chars and report them.
Run: python fix_unicode.py
"""
import os, sys

TARGET_DIR = r"D:\Automation\AURA-V3"
SCAN_DIRS  = [
    r"D:\Automation\AURA-V3\engine\forges",
    TARGET_DIR,  # root py files only (not subdirs)
]
ROOT_FILES  = [
    "forge_main.py", "config.py", "models.py",
    "audit.py", "preflight.py", "dry_run.py",
    "test_forge.py", "tts_probe.py",
]

found = []

# Scan engine/forges/
forge_dir = os.path.join(TARGET_DIR, "engine", "forges")
for f in os.listdir(forge_dir):
    if not f.endswith(".py"):
        continue
    fp = os.path.join(forge_dir, f)
    txt = open(fp, encoding="utf-8").read()
    for lineno, line in enumerate(txt.splitlines(), 1):
        for col, c in enumerate(line):
            if ord(c) > 127:
                found.append({
                    "file": fp,
                    "line": lineno,
                    "col":  col,
                    "char": c,
                    "code": ord(c),
                    "ctx":  line[:100],
                })

# Scan root-level files
for fname in ROOT_FILES:
    fp = os.path.join(TARGET_DIR, fname)
    if not os.path.exists(fp):
        continue
    txt = open(fp, encoding="utf-8").read()
    for lineno, line in enumerate(txt.splitlines(), 1):
        for col, c in enumerate(line):
            if ord(c) > 127:
                found.append({
                    "file": fp,
                    "line": lineno,
                    "col":  col,
                    "char": c,
                    "code": ord(c),
                    "ctx":  line[:100],
                })

if not found:
    print("NO non-ASCII chars found in any forge .py file.")
else:
    print(f"Found {len(found)} non-ASCII chars:\n")
    for item in found:
        rel = os.path.relpath(item["file"], TARGET_DIR)
        print(f"  {rel}:{item['line']}  U+{item['code']:04X}  ctx: {item['ctx']}")

sys.exit(0 if not found else 1)
