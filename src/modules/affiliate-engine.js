'use strict';

const { getModuleLogger } = require('../utils/logger');
const { AffiliateProgram, VideoRecord } = require('../db/schema');
const { getPublisherPlugin } = require('./publisher/index');

const log = getModuleLogger('affiliate-engine');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Select an appropriate affiliate program for a video.
 * Checks vertical match, injection frequency, and topic relevance.
 *
 * @param {Object} videoRecord
 * @returns {Promise<{programId, ctaForDescription, ctaForComment, shortUrl}|null>}
 */
async function selectAffiliateForVideo(videoRecord) {
  try {
    const programs = await AffiliateProgram.find({
      isActive: true,
      verticals: videoRecord.verticalId
    });

    if (programs.length === 0) return null;

    for (const program of programs) {
      // Count how many of our recent videos already have this affiliate
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const videosWithThisAffiliate = await VideoRecord.countDocuments({
        accountId: videoRecord.accountId,
        affiliateLinksUsed: program.programId,
        uploadDate: { $gte: thirtyDaysAgo }
      });

      const totalRecentVideos = await VideoRecord.countDocuments({
        accountId: videoRecord.accountId,
        uploadDate: { $gte: thirtyDaysAgo }
      });

      const currentRatio = videosWithThisAffiliate / Math.max(totalRecentVideos, 1);
      const targetRatio = 1 / program.injectionFrequency;

      if (currentRatio < targetRatio) {
        // Time to inject this program
        const shortUrl = await shortenUrl(program.referralUrl);

        log.info(`Affiliate selected: ${program.programId} (ratio ${currentRatio.toFixed(2)} < target ${targetRatio.toFixed(2)})`);

        return {
          programId: program.programId,
          ctaForDescription: `\n\n${program.ctaText}\n🔗 ${shortUrl}`,
          ctaForComment: `${program.ctaText} 👉 ${shortUrl}`,
          shortUrl
        };
      }
    }

    return null; // No affiliate needed for this video
  } catch (err) {
    log.warn(`Affiliate selection error: ${err.message}`);
    return null;
  }
}

/**
 * Shorten a URL using Bitly or TinyURL fallback.
 * @param {string} longUrl
 * @returns {Promise<string>}
 */
async function shortenUrl(longUrl) {
  // Tier 1: Bitly (1,000 links/month free)
  if (process.env.BITLY_API_KEY) {
    try {
      const res = await fetch('https://api-ssl.bitly.com/v4/shorten', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.BITLY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ long_url: longUrl }),
        signal: AbortSignal.timeout(10000)
      });
      const data = await res.json();
      if (data.link) return data.link;
    } catch (err) {
      log.warn(`Bitly shortening failed: ${err.message}`);
    }
  }

  // Tier 2: TinyURL (free, no key)
  try {
    const res = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const shortened = await res.text();
    if (shortened.startsWith('http')) return shortened;
  } catch (err) {
    log.warn(`TinyURL shortening failed: ${err.message}`);
  }

  // Fallback: return original URL
  return longUrl;
}

/**
 * Post an affiliate comment on the uploaded video (with natural delay).
 *
 * @param {Object} publishResult - {platformVideoId, url, status}
 * @param {Object} affiliateData - from selectAffiliateForVideo
 * @param {Object} channel - Channel document
 */
async function injectAffiliateComment(publishResult, affiliateData, channel) {
  if (!affiliateData || !publishResult?.platformVideoId) return;

  const plugin = getPublisherPlugin(channel.platform);
  if (!plugin) {
    log.warn(`No publisher plugin for ${channel.platform} — skipping affiliate comment`);
    return;
  }

  try {
    // Wait 30-120 seconds before commenting (looks natural)
    const delay = Math.floor(Math.random() * 90000) + 30000;
    log.info(`Waiting ${Math.round(delay / 1000)}s before posting affiliate comment...`);
    await sleep(delay);

    await plugin.postComment(
      publishResult.platformVideoId,
      affiliateData.ctaForComment,
      channel
    );

    log.info(`Affiliate comment posted: ${affiliateData.programId} on ${publishResult.platformVideoId}`);
  } catch (err) {
    log.warn(`Affiliate comment failed (non-critical): ${err.message}`);
  }
}

module.exports = { selectAffiliateForVideo, injectAffiliateComment, shortenUrl };
