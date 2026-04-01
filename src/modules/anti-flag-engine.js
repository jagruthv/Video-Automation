'use strict';

const { getModuleLogger } = require('../utils/logger');
const { VideoRecord, UploadSchedule } = require('../db/schema');
const { diceSimilarity } = require('./deduplication-guard');

const log = getModuleLogger('anti-flag');

/**
 * Compute uniqueness score for a video (0-100).
 * Videos scoring below the threshold are held and regenerated.
 *
 * @param {Object} videoRecord - Mongoose VideoRecord document
 * @returns {Promise<number>} Score 0-100
 */
async function computeUniquenessScore(videoRecord) {
  let score = 0;

  try {
    // 1. Topic uniqueness — is this topic far from recent topics? (+25 max)
    const recentVideos = await VideoRecord.find({
      accountId: videoRecord.accountId,
      status: { $in: ['uploaded', 'processing'] }
    }).sort({ createdAt: -1 }).limit(50).select('topic').lean();

    if (recentVideos.length > 0) {
      const recentTopics = recentVideos.map(v => v.topic).filter(Boolean);
      let maxSim = 0;
      for (const rt of recentTopics) {
        const sim = diceSimilarity(
          (videoRecord.topic || '').toLowerCase(),
          rt.toLowerCase()
        );
        if (sim > maxSim) maxSim = sim;
      }
      score += Math.round((1 - maxSim) * 25);
    } else {
      score += 25; // First video — full topic uniqueness
    }

    // 2. Voice variation — different voice than last 2 videos? (+20 max)
    const recentVoiceVideos = await VideoRecord.find({
      accountId: videoRecord.accountId,
      ttsVoice: { $ne: null }
    }).sort({ createdAt: -1 }).limit(2).select('ttsVoice').lean();

    const recentVoices = recentVoiceVideos.map(v => v.ttsVoice);
    if (!recentVoices.includes(videoRecord.ttsVoice)) {
      score += 20;
    } else {
      score += 5;
    }

    // 3. Visual variation — different background source? (+20 max)
    const recentVisualVideos = await VideoRecord.find({
      accountId: videoRecord.accountId,
      visualProvider: { $ne: null }
    }).sort({ createdAt: -1 }).limit(3).select('visualProvider').lean();

    const recentVisuals = recentVisualVideos.map(v => v.visualProvider);
    if (!recentVisuals.includes(videoRecord.visualProvider)) {
      score += 20;
    } else {
      score += 8;
    }

    // 4. Script structure variation — hook style differs? (+15 max)
    const recentScripts = await VideoRecord.find({
      accountId: videoRecord.accountId,
      scriptJson: { $ne: null }
    }).sort({ createdAt: -1 }).limit(2).select('scriptJson').lean();

    if (recentScripts.length > 0) {
      const currentHookStyle = detectHookStyle(videoRecord.scriptJson?.hook || '');
      const recentHookStyles = recentScripts.map(v => detectHookStyle(v.scriptJson?.hook || ''));
      if (!recentHookStyles.includes(currentHookStyle)) {
        score += 15;
      } else {
        score += 5;
      }
    } else {
      score += 15;
    }

    // 5. Upload timing variation — time gap from last upload? (+10 max)
    const lastUploaded = await VideoRecord.findOne({
      accountId: videoRecord.accountId,
      status: 'uploaded'
    }).sort({ uploadDate: -1 }).select('uploadDate').lean();

    if (lastUploaded?.uploadDate) {
      const gapHours = (Date.now() - lastUploaded.uploadDate.getTime()) / (1000 * 60 * 60);
      score += gapHours > 3 ? 10 : gapHours > 1.5 ? 5 : 2;
    } else {
      score += 10;
    }

    // 6. Metadata variation — title/tag overlap? (+10 max)
    const recentMeta = await VideoRecord.find({
      accountId: videoRecord.accountId,
      status: 'uploaded'
    }).sort({ createdAt: -1 }).limit(3).select('scriptJson').lean();

    if (recentMeta.length > 0) {
      const currentTags = new Set(videoRecord.scriptJson?.youtube_tags || []);
      let maxOverlap = 0;
      for (const v of recentMeta) {
        const pastTags = new Set(v.scriptJson?.youtube_tags || []);
        let overlap = 0;
        for (const tag of currentTags) {
          if (pastTags.has(tag)) overlap++;
        }
        const overlapRatio = currentTags.size > 0 ? overlap / currentTags.size : 0;
        if (overlapRatio > maxOverlap) maxOverlap = overlapRatio;
      }
      score += Math.round((1 - maxOverlap) * 10);
    } else {
      score += 10;
    }
  } catch (err) {
    log.warn(`Uniqueness scoring error: ${err.message} — returning conservative score`);
    return 60; // Conservative fallback
  }

  return Math.min(score, 100);
}

/**
 * Detect hook style type for variation tracking.
 */
function detectHookStyle(hookText) {
  if (!hookText) return 'unknown';
  if (hookText.includes('?')) return 'question';
  if (/\d+%|\d+ (million|billion|thousand)/i.test(hookText)) return 'statistic';
  if (/never|always|every|nobody|impossible/i.test(hookText)) return 'bold_claim';
  if (/imagine|picture this|what if/i.test(hookText)) return 'scenario';
  return 'statement';
}

/**
 * Generate a randomized upload schedule for a channel.
 * Mimics human posting patterns with peak-hour clustering.
 *
 * @param {string} accountId
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} count - Number of upload slots
 * @returns {Promise<Array<{time: Date, used: boolean}>>}
 */
async function generateUploadSchedule(accountId, dateStr = null, count = null) {
  const maxDaily = count || parseInt(process.env.MAX_DAILY_UPLOADS_PER_CHANNEL) || 5;
  const startHour = parseInt(process.env.UPLOAD_WINDOW_START_HOUR) || 8;
  const endHour = parseInt(process.env.UPLOAD_WINDOW_END_HOUR) || 23;

  const today = dateStr || new Date().toISOString().split('T')[0];

  // Check if schedule already exists for today
  const existing = await UploadSchedule.findOne({ accountId, date: today });
  if (existing) return existing.slots;

  const baseDate = new Date(today + 'T00:00:00Z');
  const slots = [];

  // Peak windows (UTC-adjusted; assume US audience)
  const peakWindow1 = { start: 12, end: 14 }; // Lunch
  const peakWindow2 = { start: 18, end: 21 }; // Evening

  // Place ~40% in peaks, ~60% in off-peak
  const peakCount = Math.ceil(maxDaily * 0.4);
  const offPeakCount = maxDaily - peakCount;

  // Generate peak slots
  const peakHours = [];
  for (let i = 0; i < Math.ceil(peakCount / 2); i++) {
    peakHours.push(randBetween(peakWindow1.start, peakWindow1.end));
  }
  for (let i = 0; i < Math.floor(peakCount / 2); i++) {
    peakHours.push(randBetween(peakWindow2.start, peakWindow2.end));
  }

  // Generate off-peak slots
  const offPeakHours = [];
  for (let i = 0; i < offPeakCount; i++) {
    let h;
    do {
      h = randBetween(startHour, endHour);
    } while (h >= peakWindow1.start && h <= peakWindow1.end ||
             h >= peakWindow2.start && h <= peakWindow2.end);
    offPeakHours.push(h);
  }

  const allHours = [...peakHours, ...offPeakHours];

  for (const h of allHours) {
    const minute = randBetween(0, 59);
    const time = new Date(baseDate);
    time.setUTCHours(h, minute, randBetween(0, 59));
    slots.push({ time, used: false });
  }

  // Sort chronologically
  slots.sort((a, b) => a.time - b.time);

  // Enforce minimum 90-minute gaps
  for (let i = 1; i < slots.length; i++) {
    const gap = (slots[i].time - slots[i - 1].time) / (1000 * 60);
    if (gap < 90) {
      slots[i].time = new Date(slots[i - 1].time.getTime() + 90 * 60 * 1000 + randBetween(0, 15) * 60000);
    }
  }

  // Save schedule
  await UploadSchedule.findOneAndUpdate(
    { accountId, date: today },
    { accountId, date: today, slots },
    { upsert: true }
  );

  log.info(`Schedule generated for ${accountId} on ${today}: ${slots.length} slots`);
  return slots;
}

/**
 * Get or create today's schedule.
 */
async function getOrCreateTodaySchedule(accountId) {
  const today = new Date().toISOString().split('T')[0];
  return generateUploadSchedule(accountId, today);
}

/**
 * Mark a schedule slot as used.
 */
async function markSlotUsed(accountId, slot, videoRecordId = null) {
  const today = new Date().toISOString().split('T')[0];
  await UploadSchedule.updateOne(
    { accountId, date: today, 'slots.time': slot.time },
    { $set: { 'slots.$.used': true, 'slots.$.videoRecordId': videoRecordId } }
  );
}

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  computeUniquenessScore, generateUploadSchedule,
  getOrCreateTodaySchedule, markSlotUsed
};
