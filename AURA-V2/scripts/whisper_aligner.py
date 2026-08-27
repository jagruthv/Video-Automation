import sys
import json
import logging
import os
try:
    from faster_whisper import WhisperModel
except ImportError:
    print("ALIGNMENT_ERROR: faster-whisper not installed (run: pip install faster-whisper)", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(level=logging.ERROR)

def align(audio_file, out_json):
    try:
        # tiny.en is only ~70MB, runs blazingly fast on CPU with int8 precision
        model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
        
        # word_timestamps=True forces the neural model to map the audio to exact milliseconds
        segments, _ = model.transcribe(audio_file, word_timestamps=True)
        
        words_data = []
        for segment in segments:
            for word in segment.words:
                w = word.word.strip()
                if len(w) > 0:
                    words_data.append({
                        "word": w,
                        "startMs": int(word.start * 1000),
                        "endMs": int(word.end * 1000)
                    })
                    
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(words_data, f)
            
    except Exception as e:
        print(f"ALIGNMENT_ERROR: {str(e)}", file=sys.stderr)
        sys.exit(1)
        
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("ALIGNMENT_ERROR: Missing arguments", file=sys.stderr)
        sys.exit(1)
    align(sys.argv[1], sys.argv[2])
