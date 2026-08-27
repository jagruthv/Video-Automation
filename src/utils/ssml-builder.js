'use strict';

/**
 * SSML Builder for edge-tts.
 * Builds SSML strings with human-like prosody variations
 * to prevent robotic-sounding output and voice fingerprinting.
 */

/**
 * Generate a random integer between min and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Build an SSML string for edge-tts with prosody variation.
 *
 * @param {string} text - Raw script text, may contain [PAUSE_Xs] markers
 * @param {string} voice - Edge-tts voice name (e.g. "en-US-AndrewMultilingualNeural")
 * @param {Object} options
 * @param {string} options.rate - Base speaking rate (default: random +3% to +8%)
 * @param {string} options.pitch - Base pitch shift (default: random -3Hz to +4Hz)
 * @param {string} options.volume - Volume adjustment (default: "+5%")
 * @param {boolean} options.isHook - If true, boost volume for hook section
 * @returns {string} Valid SSML XML string
 */
function buildSSML(text, voice, options = {}) {
  const baseRateNum = options.rate ? parseInt(options.rate) : randomBetween(3, 8);
  const basePitchNum = options.pitch ? parseInt(options.pitch) : randomBetween(-3, 4);
  const volume = options.volume || (options.isHook ? '+8%' : '+5%');

  // Split text at [PAUSE_Xs] markers
  const segments = text.split(/\[PAUSE_[\d.]+s\]/g);
  const pauseMatches = text.match(/\[PAUSE_([\d.]+)s\]/g) || [];

  let ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">`;
  ssml += `<voice name="${voice}">`;

  segments.forEach((segment, i) => {
    const trimmed = segment.trim();
    if (!trimmed) {
      // Still insert pause if exists
      if (i < pauseMatches.length) {
        const pauseSeconds = parseFloat(pauseMatches[i].match(/[\d.]+/)[0]);
        const pauseMs = Math.round(pauseSeconds * 1000);
        ssml += `<break time="${pauseMs}ms"/>`;
      }
      return;
    }

    // Vary prosody slightly per segment for naturalness
    const segRate = `+${baseRateNum + randomBetween(-2, 2)}%`;
    const segPitch = `${basePitchNum + randomBetween(-1, 1)}Hz`;

    ssml += `<prosody rate="${segRate}" pitch="${segPitch}" volume="${volume}">`;
    ssml += escapeXml(trimmed);
    ssml += `</prosody>`;

    // Insert pause if it exists between segments
    if (i < pauseMatches.length) {
      const pauseSeconds = parseFloat(pauseMatches[i].match(/[\d.]+/)[0]);
      const pauseMs = Math.round(pauseSeconds * 1000);
      ssml += `<break time="${pauseMs}ms"/>`;
    }
  });

  ssml += `</voice></speak>`;
  return ssml;
}

/**
 * Escape special XML characters in text.
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Get a random voice from the rotation pool.
 * Avoids using the same voice as the last N videos.
 *
 * @param {string[]} recentVoices - Voices used in recent videos
 * @param {number} avoidCount - Number of recent voices to avoid (default: 2)
 * @returns {string} Selected voice name
 */
function selectVoice(recentVoices = [], avoidCount = 2) {
  const VOICE_POOL = [
    'en-US-AndrewMultilingualNeural',   // casual male
    'en-US-AvaMultilingualNeural',       // friendly female
    'en-US-BrianMultilingualNeural',     // authoritative male
    'en-US-EmmaMultilingualNeural'       // warm female
  ];

  const recentSet = new Set(recentVoices.slice(0, avoidCount));
  const available = VOICE_POOL.filter((v) => !recentSet.has(v));

  if (available.length === 0) {
    // All voices recently used — pick random from full pool
    return VOICE_POOL[Math.floor(Math.random() * VOICE_POOL.length)];
  }

  return available[Math.floor(Math.random() * available.length)];
}

module.exports = { buildSSML, selectVoice, randomBetween, escapeXml };
