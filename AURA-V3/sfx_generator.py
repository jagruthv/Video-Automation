"""
SFX Generator — Mode 8
Generates all required sound effects using Python stdlib (wave + math).
No external downloads, no API keys. Creates unique audio fingerprints.
Run once: python sfx_generator.py
"""
import math, struct, wave, subprocess
from pathlib import Path

SFX_DIR = Path(r"D:\Automation\SFX")
SFX_DIR.mkdir(parents=True, exist_ok=True)

SAMPLE_RATE = 44100

def _write_wav(path: Path, frames: bytes, channels: int = 1):
    with wave.open(str(path), "w") as f:
        f.setnchannels(channels)
        f.setsampwidth(2)  # 16-bit
        f.setframerate(SAMPLE_RATE)
        f.writeframes(frames)

def _to_mp3(wav: Path, mp3: Path):
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav), "-ar", "44100", "-ab", "128k", str(mp3)],
        capture_output=True
    )
    wav.unlink(missing_ok=True)

def _sample(t: float, freq: float, amp: float = 1.0) -> float:
    return amp * math.sin(2 * math.pi * freq * t)

def _fade(t: float, duration: float, fade_s: float = 0.02) -> float:
    return min(t / fade_s, 1.0, (duration - t) / fade_s)

def _pack(val: float) -> bytes:
    return struct.pack("<h", max(-32767, min(32767, int(val * 32767))))


# ── 1. ping.mp3 — Clean digital notification ───────────────────────────────
def make_ping():
    dur = 0.35
    frames = b""
    for i in range(int(SAMPLE_RATE * dur)):
        t = i / SAMPLE_RATE
        v = _fade(t, dur) * (_sample(t, 880) * 0.6 + _sample(t, 1320) * 0.3)
        # Exponential decay
        v *= math.exp(-t * 8)
        frames += _pack(v)
    wav = SFX_DIR / "ping.wav"
    _write_wav(wav, frames)
    _to_mp3(wav, SFX_DIR / "ping.mp3")
    print("  [OK] ping.mp3")


# ── 2. whoosh.mp3 — Airy cut transition ────────────────────────────────────
def make_whoosh():
    import random
    rng = random.Random(42)
    dur = 0.5
    frames = b""
    for i in range(int(SAMPLE_RATE * dur)):
        t = i / SAMPLE_RATE
        # White noise shaped like a whoosh envelope (rise then fall)
        noise = rng.uniform(-1, 1)
        envelope = math.sin(math.pi * t / dur) * 0.6  # bell curve
        # Low-pass feel: mix low freq sine
        tone = _sample(t, 120) * 0.15
        v = (noise * envelope + tone) * _fade(t, dur, 0.05)
        frames += _pack(v)
    wav = SFX_DIR / "whoosh.wav"
    _write_wav(wav, frames)
    _to_mp3(wav, SFX_DIR / "whoosh.mp3")
    print("  [OK] whoosh.mp3")


# ── 3. paper.mp3 — Document/paper rustle ───────────────────────────────────
def make_paper():
    import random
    rng = random.Random(7)
    dur = 0.25
    frames = b""
    for i in range(int(SAMPLE_RATE * dur)):
        t = i / SAMPLE_RATE
        noise = rng.uniform(-1, 1)
        # Fast attack, moderate decay
        env = math.exp(-t * 20) * 0.7 + math.exp(-t * 5) * 0.3
        v = noise * env * _fade(t, dur, 0.01)
        frames += _pack(v)
    wav = SFX_DIR / "paper.wav"
    _write_wav(wav, frames)
    _to_mp3(wav, SFX_DIR / "paper.mp3")
    print("  [OK] paper.mp3")


# ── 4. impact.mp3 — Dramatic bass hit ──────────────────────────────────────
def make_impact():
    dur = 0.6
    frames = b""
    for i in range(int(SAMPLE_RATE * dur)):
        t = i / SAMPLE_RATE
        # Low bass thud + high click at onset
        bass = _sample(t, 60) * math.exp(-t * 8) * 0.7
        click = _sample(t, 800) * math.exp(-t * 60) * 0.3
        v = (bass + click) * _fade(t, dur, 0.003)
        frames += _pack(v)
    wav = SFX_DIR / "impact.wav"
    _write_wav(wav, frames)
    _to_mp3(wav, SFX_DIR / "impact.mp3")
    print("  [OK] impact.mp3")


# ── 5. keyboard.mp3 — Short typing click ───────────────────────────────────
def make_keyboard():
    import random
    rng = random.Random(13)
    dur = 0.08
    frames = b""
    for i in range(int(SAMPLE_RATE * dur)):
        t = i / SAMPLE_RATE
        noise = rng.uniform(-1, 1)
        v = noise * math.exp(-t * 80) * 0.5 * _fade(t, dur, 0.003)
        frames += _pack(v)
    wav = SFX_DIR / "keyboard.wav"
    _write_wav(wav, frames)
    _to_mp3(wav, SFX_DIR / "keyboard.mp3")
    print("  [OK] keyboard.mp3")


if __name__ == "__main__":
    print(f"[SFX] Generating sound effects → {SFX_DIR}")
    make_ping()
    make_whoosh()
    make_paper()
    make_impact()
    make_keyboard()
    print(f"[SFX] Done. All 5 SFX files ready in {SFX_DIR}")
