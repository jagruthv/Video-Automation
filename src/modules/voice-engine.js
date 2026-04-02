'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const { buildSSML, selectVoice } = require('../utils/ssml-builder');
const { VideoRecord } = require('../db/schema');

const log = getModuleLogger('voice-engine');

/**
 * Get recently used voices for an account (for rotation).
 * @param {string} accountId
 * @param {number} limit
 * @returns {Promise<string[]>}
 */
async function getRecentVoices(accountId, limit = 2) {
  try {
    const docs = await VideoRecord.find({ accountId, ttsVoice: { $ne: null } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('ttsVoice')
      .lean();
    return docs.map(d => d.ttsVoice).filter(Boolean);
  } catch { return []; }
}

// ============================================================
// TIER 1: edge-tts (Microsoft Edge Neural Voices) — PRIMARY
// Free, unlimited, near-human quality with SSML + word timestamps
// ============================================================
const edgeTTS = {
  name: 'edge-tts',

  async synthesize(scriptText, options = {}) {
    const { EdgeTTS } = await import('edge-tts-universal');

    const recentVoices = options.recentVoices || [];
    const voice = selectVoice(recentVoices);
    log.info(`edge-tts: Using voice "${voice}"`);

    const wordTimestamps = [];
    let audioBuffer;

    try {
      // edge-tts-universal 1.4+ synthesize API
      const tts = new EdgeTTS(scriptText, voice);
      const result = await tts.synthesize();
      audioBuffer = Buffer.from(await result.audio.arrayBuffer());

      // Extract word boundaries array (now called subtitle)
      if (result.subtitle && Array.isArray(result.subtitle)) {
        for (const wb of result.subtitle) {
          wordTimestamps.push({
            word: wb.text,
            startMs: Math.round(wb.offset / 10000),
            endMs: Math.round((wb.offset + wb.duration) / 10000)
          });
        }
      }
    } catch (err) {
      log.warn(`edge-tts synthesis failed: ${err.message}`);
      throw err;
    }

    if (!audioBuffer || audioBuffer.length < 1000) {
      throw new Error('edge-tts produced empty or too-small audio');
    }

    // If no word timestamps, estimate from text
    if (wordTimestamps.length === 0) {
      const estimated = estimateWordTimestamps(scriptText, audioBuffer.length);
      wordTimestamps.push(...estimated);
    }

    const durationMs = estimateAudioDuration(audioBuffer);

    return {
      audioBuffer,
      wordTimestamps,
      durationMs,
      provider: 'edge-tts',
      voice
    };
  }
};

// ============================================================
// TIER 2: gTTS (Google Text-to-Speech) — FALLBACK
// Free, unlimited, lower quality but reliable
// (Kokoro.js skipped in GH Actions — too heavy for CI)
// ============================================================
const gTTS = {
  name: 'gtts',

  async synthesize(scriptText, options = {}) {
    const gttsLib = require('node-gtts');
    const lang = options.lang || 'en';
    const tts = gttsLib(lang);

    // Remove pause markers for gTTS (doesn't support SSML)
    const cleanText = scriptText.replace(/\[PAUSE_[\d.]+s\]/g, '. ');

    return new Promise((resolve, reject) => {
      const chunks = [];
      const stream = tts.stream(cleanText);

      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const audioBuffer = Buffer.concat(chunks);
        if (audioBuffer.length < 500) {
          return reject(new Error('gTTS produced empty audio'));
        }

        const durationMs = estimateAudioDuration(audioBuffer);
        const wordTimestamps = estimateWordTimestamps(cleanText, durationMs);

        resolve({
          audioBuffer,
          wordTimestamps,
          durationMs,
          provider: 'gtts',
          voice: `gtts-${lang}`
        });
      });
      stream.on('error', reject);
    });
  }
};

// ============================================================
// TIER 3: OpenAI TTS (Optional Paid — Ultra Realistic)
// Only used if OPENAI_API_KEY is set AND other tiers fail
// ============================================================
const openaiTTS = {
  name: 'openai-tts',

  async synthesize(scriptText, options = {}) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');

    const cleanText = scriptText.replace(/\[PAUSE_[\d.]+s\]/g, '... ');
    const voices = ['onyx', 'nova', 'alloy', 'echo', 'fable', 'shimmer'];
    const voice = voices[Math.floor(Math.random() * voices.length)];

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: cleanText,
        voice,
        response_format: 'mp3',
        speed: 1.05
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!res.ok) throw new Error(`OpenAI TTS HTTP ${res.status}`);

    const audioBuffer = Buffer.from(await res.arrayBuffer());
    const durationMs = estimateAudioDuration(audioBuffer);
    const wordTimestamps = estimateWordTimestamps(cleanText, durationMs);

    return {
      audioBuffer,
      wordTimestamps,
      durationMs,
      provider: 'openai-tts',
      voice: `openai-${voice}`
    };
  }
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Estimate audio duration from buffer size.
 * Rough: MP3 at 128kbps = 16KB/sec
 * @param {Buffer} buffer
 * @returns {number} Duration in milliseconds
 */
function estimateAudioDuration(buffer) {
  const bytes = buffer.length;
  const bytesPerSec = 16000; // ~128kbps MP3
  return Math.round((bytes / bytesPerSec) * 1000);
}

/**
 * Estimate word-level timestamps from text when TTS doesn't provide them.
 * Uses average speech rate of ~150 words per minute.
 * @param {string} text
 * @param {number} totalDurationMs
 * @returns {Array<{word: string, startMs: number, endMs: number}>}
 */
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

/**
 * Save audio buffer to a file.
 * @param {Buffer} buffer
 * @param {string} filePath
 */
function saveAudio(buffer, filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  log.info(`Audio saved: ${filePath} (${(buffer.length / 1024).toFixed(0)}KB)`);
}

// ============================================================
// MAIN VOICE GENERATION — 3-TIER CASCADE
// ============================================================

/**
 * Generate voice audio from script text using the TTS cascade.
 *
 * Tier 1: edge-tts (free, unlimited, high quality)
 * Tier 2: gTTS (free, unlimited, lower quality)
 * Tier 3: OpenAI TTS (paid, only if API key exists and others fail)
 *
 * @param {string} scriptText - Full script with [PAUSE_0.5s] markers
 * @param {Object} options
 * @param {string} options.accountId - For voice rotation tracking
 * @param {string} options.outputPath - Where to save the audio file
 * @returns {Promise<{audioPath: string, wordTimestamps: Array, durationMs: number, provider: string, voice: string}>}
 */
async function generateVoice(scriptText, options = {}) {
  const outputPath = options.outputPath || '/tmp/build/audio/voice.mp3';

  // Get recent voices for anti-fingerprint rotation
  let recentVoices = [];
  if (options.accountId) {
    recentVoices = await getRecentVoices(options.accountId);
  }

  const tiers = [edgeTTS, gTTS];

  // Only add OpenAI if key exists
  if (process.env.OPENAI_API_KEY) {
    tiers.splice(1, 0, openaiTTS); // Insert after edge-tts, before gTTS
  }

  for (const tier of tiers) {
    try {
      log.info(`TTS: Trying ${tier.name}...`);
      const result = await withRetry(
        () => tier.synthesize(scriptText, { recentVoices }),
        { maxRetries: 2, name: `tts-${tier.name}`, baseDelay: 2000 }
      );

      saveAudio(result.audioBuffer, outputPath);

      log.info(`TTS: ${tier.name} succeeded — ${result.durationMs}ms, voice: ${result.voice}`);
      return {
        audioPath: outputPath,
        wordTimestamps: result.wordTimestamps,
        durationMs: result.durationMs,
        provider: result.provider,
        voice: result.voice
      };
    } catch (err) {
      log.warn(`TTS ${tier.name} failed: ${err.message}`);
      continue;
    }
  }

  throw new Error('ALL_TTS_PROVIDERS_EXHAUSTED');
}

module.exports = { generateVoice, estimateWordTimestamps, estimateAudioDuration };
