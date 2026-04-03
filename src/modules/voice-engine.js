'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const log = getModuleLogger('voice-engine');

// ============================================================
// Microsoft Edge TTS — SOLE PRIMARY ENGINE
// Free Microsoft Azure Neural TTS. No API key required.
// Default: en-US-ChristopherNeural (deep, resonant bass)
// Override via env: EDGE_VOICE_ID
// ============================================================
const microsoftEdgeTTS = {
  name: 'microsoft-edge-tts',

  get VOICE() {
    return process.env.EDGE_VOICE_ID || 'en-US-ChristopherNeural';
  },

  async synthesize(scriptText, outputPath) {
    const { Communicate } = require('edge-tts-universal');
    const voiceName = this.VOICE;
    const cleanText = scriptText.replace(/\[PAUSE_[\d.]+s\]/g, '').trim();

    if (!cleanText) throw new Error('Edge TTS: Script text is empty after cleaning');

    log.info(`🎙️ Generating audio with heavy-bass Edge TTS voice: ${voiceName}...`);

    const communicate = new Communicate(cleanText, {
      voice: voiceName,
      rate: '-5%',    // Slightly slower for dramatic "facts" pacing
      pitch: '-5Hz'   // Lower pitch for deep bass resonance
    });

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Collect audio chunks from the async stream iterator
    const chunks = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data));
      }
    }

    if (chunks.length === 0) throw new Error('Edge TTS stream returned no audio chunks');
    const audioBuffer = Buffer.concat(chunks);
    fs.writeFileSync(outputPath, audioBuffer);
    if (!audioBuffer || audioBuffer.length < 1000) {
      throw new Error('Edge TTS: Produced an empty or too-small audio buffer');
    }

    const durationMs = estimateAudioDuration(audioBuffer);
    const wordTimestamps = estimateWordTimestamps(cleanText, durationMs);

    return {
      audioBuffer,
      wordTimestamps,
      durationMs,
      provider: 'microsoft-edge-tts',
      voice: voiceName
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
  const { execSync } = require('child_process');

  log.info(`TTS: Starting Microsoft Edge TTS (${microsoftEdgeTTS.VOICE})...`);

  try {
    const result = await withRetry(
      () => microsoftEdgeTTS.synthesize(scriptText, outputPath),
      { maxRetries: 3, name: 'tts-edge', baseDelay: 2000 }
    );

    if (fs.existsSync(outputPath)) {
      log.info(`Audio saved: ${outputPath} (${(result.audioBuffer.length / 1024).toFixed(0)}KB)`);
    } else {
      saveAudio(result.audioBuffer, outputPath);
    }

    // Get TRUE duration via ffprobe — Edge TTS outputs at 80kbps MPEG2, not 128kbps.
    // Byte-based estimation is 60% too short, causing subtitles to appear way too early.
    let trueDurationMs = result.durationMs; // fallback estimate
    try {
      const ffprobeOut = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`,
        { encoding: 'utf8' }
      ).trim();
      const trueSec = parseFloat(ffprobeOut);
      if (!isNaN(trueSec) && trueSec > 0) {
        trueDurationMs = Math.round(trueSec * 1000);
        log.info(`Audio duration (ffprobe): ${trueSec.toFixed(2)}s (estimated was ${(result.durationMs/1000).toFixed(2)}s)`);
      }
    } catch {
      log.warn('ffprobe not available — using byte-estimate for word timestamps');
    }

    const wordTimestamps = estimateWordTimestamps(
      scriptText.replace(/\[PAUSE_[\d.]+s\]/g, '').trim(),
      trueDurationMs
    );

    log.info(`TTS: Edge TTS succeeded — ${trueDurationMs}ms, voice: ${result.voice}`);

    return {
      audioPath: outputPath,
      wordTimestamps,
      durationMs: trueDurationMs,
      provider: result.provider,
      voice: result.voice
    };
  } catch (err) {
    log.error(`TTS: Microsoft Edge TTS failed after all retries: ${err.message}`);
    throw new Error('ALL_TTS_PROVIDERS_EXHAUSTED');
  }
}

module.exports = { generateVoice, estimateWordTimestamps, estimateAudioDuration };
