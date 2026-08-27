import subprocess, sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

files = [
    (r'D:\Automation\AURA-V3\tmp\audio\fix_v58_onyx.mp3', 200),
    (r'D:\Automation\AURA-V3\tmp\audio\test_onyx.mp3', 4),
]

TARGET_S = 50  # target video duration in seconds

for path, word_count in files:
    p = Path(path)
    if not p.exists():
        print(f'NOT FOUND: {p.name}')
        continue
    r = subprocess.run(
        ['ffprobe','-v','quiet','-show_entries','format=duration','-of','csv=p=0', str(p)],
        capture_output=True, text=True
    )
    dur = float(r.stdout.strip())
    wpm_natural  = word_count / dur * 60
    atempo_needed = dur / TARGET_S
    wpm_at_14    = word_count / (dur / 1.4) * 60

    print(f"\n{p.name}  ({word_count} words)")
    print(f"  Raw duration : {dur:.1f}s")
    print(f"  Natural WPM  : {wpm_natural:.0f} wpm")
    print(f"  At 1.4x      : {dur/1.4:.1f}s  ({wpm_at_14:.0f} wpm)")
    print(f"  Needed atempo to hit {TARGET_S}s: {atempo_needed:.2f}x")
    if atempo_needed > 2.0:
        a1 = 2.0
        a2 = round(atempo_needed / 2.0, 2)
        print(f"  FFmpeg filter : atempo={a1},atempo={a2}  (chained — max single is 2.0)")
    else:
        print(f"  FFmpeg filter : atempo={atempo_needed:.2f}")
