import logging
import re
import subprocess
from pathlib import Path
from config import (
    FFMPEG_PATH, OUTPUT_WIDTH, OUTPUT_HEIGHT,
    OUTPUT_FPS, VIDEO_BITRATE, AUDIO_BITRATE,
    TMP_RENDER_DIR, OUTPUT_DIR,
    TTS_SPEED, VIDEO_SPEED,
)
from engine.vault import VaultClip

logger = logging.getLogger("aura.compositor")

# Derive ffprobe from ffmpeg path so custom installs (e.g. D:\ffmpeg\bin\ffmpeg.exe)
# automatically resolve to D:\ffmpeg\bin\ffprobe.exe
_ffmpeg_path = Path(FFMPEG_PATH)
FFPROBE_PATH = str(_ffmpeg_path.parent / "ffprobe") if _ffmpeg_path.parent != Path(".") else "ffprobe"

# Pre-compute setpts factor as a clean decimal string FFmpeg can parse
# VIDEO_SPEED=2.0 → '0.5' (NOT '1/2.0' which FFmpeg rejects)
_SETPTS_FACTOR = f"{1.0 / VIDEO_SPEED:.6f}".rstrip("0").rstrip(".")
# e.g. '0.5' for 2x, '0.333333' for 3x, etc.


def _slug(title: str, max_len: int = 55) -> str:
    """Turn a raw title into a safe, readable filename slug (unicode-aware)."""
    slug = re.sub(r"[^\w\s-]", "", title, flags=re.UNICODE)
    slug = re.sub(r"[\s_]+", "-", slug.strip())
    slug = re.sub(r"-{2,}", "-", slug)
    slug = slug[:max_len].rstrip("-")
    return slug if slug else "video"


class FFmpegCompositor:
    """
    Assembles the final 9:16 production-ready MP4.
    """
    # Expose speed constants so callers (main.py) can compute source_needed
    TTS_SPEED   = TTS_SPEED
    VIDEO_SPEED = VIDEO_SPEED


    def generate_subtitles(self, audio_path: Path, output_srt: Path, speed_factor: float, offset_s: float):
        segments = []
        try:
            import urllib.request
            import json
            import mimetypes
            import secrets
            
            logger.info("[COMPOSITOR] 🔍 Attempting Pollinations Whisper Large V3 API...")
            
            # Read audio data
            with open(audio_path, "rb") as f:
                audio_data = f.read()
                
            boundary = secrets.token_hex(16)
            headers = {
                'Content-Type': f'multipart/form-data; boundary={boundary}',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
            
            # Construct multipart payload
            body = bytearray()
            
            # model part
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(b'Content-Disposition: form-data; name="model"\r\n\r\n')
            body.extend(b'whisper-large-v3\r\n')
            
            # response_format part
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(b'Content-Disposition: form-data; name="response_format"\r\n\r\n')
            body.extend(b'verbose_json\r\n')

            # timestamp_granularities[] part (crucial for word-level timestamps in OpenAI-compatible API)
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(b'Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n')
            body.extend(b'word\r\n')
            
            # file part
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(f'Content-Disposition: form-data; name="file"; filename="{audio_path.name}"\r\n'.encode())
            body.extend(b'Content-Type: audio/mpeg\r\n\r\n')
            body.extend(audio_data)
            body.extend(b'\r\n')
            
            body.extend(f"--{boundary}--\r\n".encode())
            
            # Add BYOP token if available
            from config import POLLINATIONS_BYOP_KEY
            if POLLINATIONS_BYOP_KEY:
                headers['Authorization'] = f'Bearer {POLLINATIONS_BYOP_KEY}'
            
            req = urllib.request.Request(
                "https://gen.pollinations.ai/v1/audio/transcriptions", 
                data=body, 
                headers=headers,
                method="POST"
            )
            
            with urllib.request.urlopen(req, timeout=120) as r:
                resp = json.loads(r.read().decode())
                
            if "words" not in resp:
                raise ValueError("No word-level timestamps in Pollinations Whisper response")
                
            # Create a mock segment structure to match faster_whisper format
            class MockWord:
                def __init__(self, word, start, end):
                    self.word = word
                    self.start = start
                    self.end = end
                    
            class MockSegment:
                def __init__(self, words):
                    self.words = words
                    
            mock_words = [MockWord(w["word"], w["start"], w["end"]) for w in resp["words"]]
            segments = [MockSegment(mock_words)]
            logger.info("[COMPOSITOR] Pollinations Whisper succeeded.")
            
        except Exception as e:
            logger.warning(f"[COMPOSITOR] Pollinations Whisper failed ({e}). Falling back to local tiny.en...")
            from faster_whisper import WhisperModel
            model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
            segments, _ = model.transcribe(str(audio_path), word_timestamps=True)
        
        def format_ts(seconds):
            ms = int((seconds % 1) * 1000)
            s = int(seconds)
            m, s = divmod(s, 60)
            h, m = divmod(m, 60)
            return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

        lines = []
        idx = 1
        for segment in segments:
            for word in segment.words:
                w = word.word.strip().upper()
                if not w: continue
                
                # Math Pacing: Factor in TTS acceleration and standard offset gap.
                # User requested a highly aggressive 0.75s "ahead" lead so text appears long before the voice.
                lead_s = 0.75
                start_val = max(0.0, (word.start / speed_factor) + offset_s - lead_s)
                end_val   = max(0.1, (word.end / speed_factor) + offset_s - lead_s)
                
                lines.extend([
                    str(idx),
                    f"{format_ts(start_val)} --> {format_ts(end_val)}",
                    w,
                    ""
                ])
                idx += 1
                
        output_srt.write_text("\n".join(lines), encoding="utf-8")

    def render(self, clip: VaultClip, audio_path: Path,
               video_id: str, title: str = "") -> Path:
        """
        Render the final sped-up video with baked Whisper subtitles.
        """
        slug        = _slug(title) if title else video_id
        output_name = f"{slug}_{video_id[:8]}.mp4"
        output_path = OUTPUT_DIR / output_name
        srt_path    = TMP_RENDER_DIR / f"{video_id}.srt"

        # ── Probe original 1.0x audio duration ─────────────────────────────
        audio_duration_1x = self._probe_duration(audio_path)
        # Factor in the 0.5s offset the user requested at the start
        offset_s          = 0.5
        output_duration   = (audio_duration_1x / TTS_SPEED) + offset_s
        source_needed     = output_duration * VIDEO_SPEED
        m, s = divmod(int(output_duration), 60)
        logger.info(
            f"[COMPOSITOR] Audio 1.0x: {audio_duration_1x:.1f}s  output: {m}:{s:02d}  "
            f"source_needed: {source_needed:.1f}s  video: {VIDEO_SPEED}x  audio: {TTS_SPEED}x"
        )

        # ── Generate Subtitles ──────────────────────────────────────────────
        self.generate_subtitles(audio_path, srt_path, TTS_SPEED, offset_s)
        # FFmpeg expects forward slashes and escaped colons for absolute paths on Windows
        srt_ff = str(srt_path.resolve()).replace('\\', '/').replace(':', '\\:')

        # ── Background clip input args ──────────────────────────────────────
        if clip.is_large:
            clip_args = [
                "-ss", f"{clip.seek_start:.3f}",
                "-i", str(clip.path),
            ]
            clip_label = f"kinetic_sand @{clip.seek_start/60:.1f}min"
        else:
            # Pre-concatenated Pinterest clip — already long enough, no looping needed
            clip_args = ["-i", str(clip.path)]
            clip_label = f"pinterest_concat ({clip.path.name})"

        logger.info(f"[COMPOSITOR] Clip: {clip_label}  source_needed: {source_needed:.1f}s")

        # ── Video filter chain ──────────────────────────────────────────────
        # Subtitles filter must run AFTER clipping/scaling to stay proportional
        video_filter = (
            f"setpts={_SETPTS_FACTOR}*PTS,"
            f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:"
            f"force_original_aspect_ratio=increase,"
            f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},"
            f"fps={OUTPUT_FPS},"
            f"""subtitles='{srt_ff}':force_style='FontName=Arial,FontSize=24,PrimaryColour=&H0000FFFF,Outline=2,Shadow=1,Alignment=10'"""
        )

        # ── Audio filter chain ──────────────────────────────────────────────
        # Applying the 0.5s offset using adelay
        delay_ms = int(offset_s * 1000)
        audio_filter = f"atempo={TTS_SPEED},adelay={delay_ms}|{delay_ms}"

        args = [
            FFMPEG_PATH, "-y",
            *clip_args,                            # background
            "-i", str(audio_path),                 # voiceover
            "-vf", video_filter,
            "-af", audio_filter,
            "-t", f"{output_duration:.3f}",        # limit to sped-up audio
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-b:v", VIDEO_BITRATE, "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", AUDIO_BITRATE,
            "-metadata", f"title={title or slug}",
            "-metadata", f"comment=AURA Remix Engine | {video_id}",
            "-metadata", "artist=AURA-V3",
            "-movflags", "+faststart",
            str(output_path),
        ]

        logger.info(f"[COMPOSITOR] Rendering → {output_name}")
        result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")

        if result.returncode != 0:
            raise RuntimeError(
                f"[COMPOSITOR] FFmpeg failed (exit {result.returncode}):\n"
                f"{result.stderr[-1500:]}"
            )

        size_mb = output_path.stat().st_size / 1024 / 1024
        logger.info(
            f"[COMPOSITOR] ✅ Done: {output_name}  "
            f"({size_mb:.1f} MB, {m}:{s:02d} final)"
        )
        return output_path

    def probe_audio_duration(self, audio_path: Path) -> float:
        """Public wrapper — returns the 1.0x duration of an audio file in seconds."""
        return self._probe_duration(audio_path)

    def _probe_duration(self, path: Path) -> float:
        result = subprocess.run(
            [FFPROBE_PATH, "-v", "error",
             "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1",
             str(path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15
        )
        raw = result.stdout.strip()
        try:
            return float(raw)
        except ValueError:
            raise RuntimeError(
                f"[COMPOSITOR] Could not probe duration of {path.name}. "
                f"stdout={raw!r}  stderr={result.stderr[-300:]!r}"
            )
