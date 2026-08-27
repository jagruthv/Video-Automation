"""
tts_validate.py -- Validate the correct Pollinations TTS endpoint
"""
import sys, requests
sys.path.insert(0, r"D:\Automation\AURA-V3")
import config
from engine.forges.audio_forge import _tts_url

key = config.POLLINATIONS_BYOP_KEY
if key:
    print(f"POLLINATIONS_BYOP_KEY: set ({len(key)} chars, starts with {key[:8]}...)")
else:
    print("POLLINATIONS_BYOP_KEY: NOT SET -- will try without auth")

print(f"TTS_MODEL : {config.TTS_MODEL}")
print(f"TTS_VOICE : {config.TTS_VOICE}")

url = _tts_url("Hello world")
print(f"URL       : {url}")
print()

hdrs = {
    "Accept"       : "audio/mpeg, audio/mp3, audio/*, */*",
    "User-Agent"   : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    "Authorization": "Bearer " + (key or ""),
}

resp = requests.get(url, headers=hdrs, timeout=30, stream=True)
chunks = []
for c in resp.iter_content(65536):
    if c:
        chunks.append(c)
data = b"".join(chunks)

ct     = resp.headers.get("Content-Type", "?")
is_mp3 = (data[:3] == b"ID3") or (len(data) >= 2 and data[0] == 0xFF and data[1] in (0xFA, 0xFB, 0xF3))

print(f"status    : {resp.status_code}")
print(f"ct        : {ct}")
print(f"size      : {len(data)} bytes")
print(f"mp3       : {is_mp3}")
print(f"first8    : {data[:8].hex()}")

if is_mp3:
    print("\n*** VALID MP3 -- TTS WORKING ***")
    sys.exit(0)
else:
    print(f"\npreview: {data[:200]!r}")
    sys.exit(1)
