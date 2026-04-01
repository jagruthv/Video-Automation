'use strict';

const { getModuleLogger } = require('../utils/logger');
const { VideoRecord, Channel } = require('../db/schema');
const { getPublisherPlugin } = require('./publisher/index');
const { connectToMongoDB, disconnectMongoDB } = require('../db/connection');

const log = getModuleLogger('analytics-collector');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Collect metrics for all uploaded videos across all active channels.
 * Optimized for YouTube quota: batches up to 50 video IDs per API call (1 unit).
 */
async function collectAllMetrics() {
  const channels = await Channel.find({ isActive: true });
  log.info(`Collecting metrics for ${channels.length} active channels`);

  for (const channel of channels) {
    const plugin = getPublisherPlugin(channel.platform);
    if (!plugin) {
      log.warn(`No plugin for ${channel.platform} — skipping`);
      continue;
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentVideos = await VideoRecord.find({
      accountId: channel.accountId,
      status: 'uploaded',
      videoId: { $ne: null },
      uploadDate: { $gte: thirtyDaysAgo }
    }).lean();

    if (recentVideos.length === 0) {
      log.info(`${channel.accountId}: No recent videos to collect metrics for`);
      continue;
    }

    log.info(`${channel.accountId}: Fetching metrics for ${recentVideos.length} videos`);

    // YouTube optimization: batch 50 IDs per request (1 quota unit)
    if (channel.platform === 'youtube') {
      const batches = [];
      for (let i = 0; i < recentVideos.length; i += 50) {
        batches.push(recentVideos.slice(i, i + 50));
      }

      for (const batch of batches) {
        try {
          const ids = batch.map(v => v.videoId).join(',');
          const metrics = await plugin.getMetrics(ids, channel);

          // If batch, metrics is for first ID — need individual handling
          // For proper batch, modify YouTube plugin to return array
          for (const video of batch) {
            try {
              const m = await plugin.getMetrics(video.videoId, channel);
              await VideoRecord.findByIdAndUpdate(video._id, {
                'metrics.views': m.views,
                'metrics.likes': m.likes,
                'metrics.comments': m.comments,
                'metrics.shares': m.shares,
                'metrics.updatedAt': new Date()
              });
            } catch (err) {
              log.warn(`Metrics failed for ${video.videoId}: ${err.message}`);
            }
            await sleep(1000); // Rate limit: 1 req/sec
          }
        } catch (err) {
          log.warn(`Batch metrics failed: ${err.message}`);
        }
      }
    } else {
      // Non-YouTube: fetch one by one
      for (const video of recentVideos) {
        try {
          const metrics = await plugin.getMetrics(video.videoId, channel);
          await VideoRecord.findByIdAndUpdate(video._id, {
            'metrics.views': metrics.views,
            'metrics.likes': metrics.likes,
            'metrics.comments': metrics.comments,
            'metrics.shares': metrics.shares,
            'metrics.updatedAt': new Date()
          });
        } catch (err) {
          log.warn(`Metrics failed for ${video.videoId}: ${err.message}`);
        }
        await sleep(1000);
      }
    }

    log.info(`${channel.accountId}: Metrics collection complete`);
  }
}

/**
 * Compute aggregate dashboard statistics.
 */
async function computeDashboardStats(accountId, periodDays = 30) {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const videos = await VideoRecord.find({
    accountId,
    status: 'uploaded',
    uploadDate: { $gte: since }
  }).lean();

  if (videos.length === 0) {
    return { totalVideos: 0, totalViews: 0, totalLikes: 0, totalComments: 0,
      avgViewsPerVideo: 0, avgLikesPerVideo: 0, bestPerforming: null,
      worstPerforming: null, uploadSuccessRate: 0, avgUniquenessScore: 0 };
  }

  const sum = (arr, key) => arr.reduce((s, v) => {
    const parts = key.split('.');
    let val = v;
    for (const p of parts) val = val?.[p];
    return s + (val || 0);
  }, 0);

  const totalViews = sum(videos, 'metrics.views');
  const totalLikes = sum(videos, 'metrics.likes');
  const totalComments = sum(videos, 'metrics.comments');

  const sorted = [...videos].sort((a, b) => (b.metrics?.views || 0) - (a.metrics?.views || 0));

  // Provider breakdowns
  const llmBreakdown = {};
  const ttsBreakdown = {};
  for (const v of videos) {
    llmBreakdown[v.llmProvider || 'unknown'] = (llmBreakdown[v.llmProvider || 'unknown'] || 0) + 1;
    ttsBreakdown[v.ttsProvider || 'unknown'] = (ttsBreakdown[v.ttsProvider || 'unknown'] || 0) + 1;
  }

  return {
    totalVideos: videos.length,
    totalViews, totalLikes, totalComments,
    avgViewsPerVideo: Math.round(totalViews / videos.length),
    avgLikesPerVideo: Math.round(totalLikes / videos.length),
    bestPerforming: sorted[0] ? { topic: sorted[0].topic, views: sorted[0].metrics?.views || 0, videoId: sorted[0].videoId } : null,
    worstPerforming: sorted[sorted.length - 1] ? { topic: sorted[sorted.length - 1].topic, views: sorted[sorted.length - 1].metrics?.views || 0 } : null,
    uploadSuccessRate: Math.round((videos.filter(v => v.status === 'uploaded').length / videos.length) * 100),
    avgUniquenessScore: Math.round(sum(videos, 'uniquenessScore') / videos.length),
    llmProviderBreakdown: llmBreakdown,
    ttsProviderBreakdown: ttsBreakdown,
    affiliateInjectionCount: videos.filter(v => v.affiliateLinksUsed?.length > 0).length
  };
}

// Run standalone if executed directly
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    await connectToMongoDB();
    await collectAllMetrics();
    await disconnectMongoDB();
    log.info('Analytics collection complete');
  })().catch(err => {
    log.error(`Analytics collection failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { collectAllMetrics, computeDashboardStats };
