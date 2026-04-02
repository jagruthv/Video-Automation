'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const log = getModuleLogger('voice-engine');

// ============================================================
// NexusTTS (Cartesia)
// ============================================================
const nexusTTS = {
  name: 'nexustts-cartesia',

  async synthesize(scriptText) {
    const key = process.env.NEXUSTTS_API_KEY;
    if (!key) throw new Error('NEXUSTTS_API_KEY not set');

    // Remove [PAUSE_0.5s] markers and newline characters just in case it breaks speech flow incorrectly
    // Wait, the API might handle newlines gracefully. We leave them for pacing as requested by user.
    const cleanText = scriptText.replace(/\[PAUSE_[\d.]+s\]/g, '');

    const res = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'Cartesia-Version': '2024-06-10',
        'X-API-Key': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model_id: 'sonic-english',
        transcript: cleanText,
        voice: {
          mode: 'id',
          id: 'e07c00bc-4134-4eae-9ea4-1a55fb45746b'
        },
        output_format: {
          container: 'mp3',
          encoding: 'pcm_f32le',
          sample_rate: 44100
        }
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      throw new Error(`NexusTTS HTTP ${res.status}: ${await res.text()}`);
    }

    const audioBuffer = Buffer.from(await res.arrayBuffer());
    
    if (!audioBuffer || audioBuffer.length < 1000) {
      throw new Error('NexusTTS produced empty or too-small audio');
    }

    const durationMs = estimateAudioDuration(audioBuffer);
    const wordTimestamps = estimateWordTimestamps(cleanText, durationMs);

    return {
      audioBuffer,
      wordTimestamps,
      durationMs,
      provider: 'nexustts-cartesia',
      voice: 'e07c00bc-4134-4eae-9ea4-1a55fb45746b'
    };
  }
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function estimateAudioDuration(buffer) {
  const bytes = buffer.length;
  const bytesPerSec = 16000; // ~128kbps MP3
  return Math.round((bytes / bytesPerSec) * 1000);
}

function estimateWordTimestamps(text, totalDurationMs) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];

  const msPerWord = totalDurationMs / words.length;
  return words.map((word, i) => ({
    word: word.replace(/[^a-zA-Z0-9']/g, ''),
    startMs: Math.round(i * msPerWord),
    endMs: Math.round((i + 1) * msPerWord)
  }));
}

function saveAudio(buffer, filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  log.info(`Audio saved: ${filePath} (${(buffer.length / 1024).toFixed(0)}KB)`);
}

// ============================================================
// MAIN VOICE GENERATION
// ============================================================
async function generateVoice(scriptText, options = {}) {
  const outputPath = options.outputPath || '/tmp/build/audio/voice.mp3';

  log.info(`TTS: Trying NexusTTS...`);
  try {
    const result = await withRetry(
      () => nexusTTS.synthesize(scriptText),
      { maxRetries: 2, name: 'tts-nexustts', baseDelay: 2000 }
    );

    saveAudio(result.audioBuffer, outputPath);

    log.info(`TTS: NexusTTS succeeded — ${result.durationMs}ms, voice: ${result.voice}`);
    return {
      audioPath: outputPath,
      wordTimestamps: result.wordTimestamps,
      durationMs: result.durationMs,
      provider: result.provider,
      voice: result.voice
    };
  } catch (err) {
    log.error(`TTS NexusTTS failed: ${err.message}`);
    throw new Error('ALL_TTS_PROVIDERS_EXHAUSTED');
  }
}

module.exports = { generateVoice, estimateWordTimestamps, estimateAudioDuration };
