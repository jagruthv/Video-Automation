'use strict';

const fs = require('fs');
const { google } = require('googleapis');
const BasePublisher = require('./base-publisher');
const { getModuleLogger } = require('../../utils/logger');
const { Channel } = require('../../db/schema');

const log = getModuleLogger('youtube-publisher');

class YouTubePublisher extends BasePublisher {
  constructor() {
    super();
    this.platform = 'youtube';
    this.costPerUpload = 1600; // YouTube API quota units per upload
  }

  /**
   * Get OAuth2 client for a channel using env var names stored in credentials.
   */
  async _getAuthClient(channel) {
    let clientId = channel.credentials.clientId;
    let clientSecret = channel.credentials.clientSecret;
    let refreshToken = channel.credentials.refreshToken;

    // Support both Environment Variable References (Scenario B) AND Direct Hardcoded Keys (Scenario A)
    if (process.env[clientId]) clientId = process.env[clientId];
    if (process.env[clientSecret]) clientSecret = process.env[clientSecret];
    if (process.env[refreshToken]) refreshToken = process.env[refreshToken];

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(`Missing YouTube credentials for ${channel.accountId}`);
    }

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }

  /**
   * Upload a video to YouTube Shorts.
   */
  async upload(videoPath, metadata, channel) {
    const auth = await this._getAuthClient(channel);
    const youtube = google.youtube({ version: 'v3', auth });

    const description = [
      metadata.youtube_description || '',
      '',
      metadata.affiliateCTA || '',
      '',
      metadata.attributions ? `Credits: ${metadata.attributions.join(', ')}` : '',
      '#Shorts'
    ].filter(Boolean).join('\n').trim();

    const res = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: (metadata.youtube_title || 'Untitled').substring(0, 100),
          description,
          tags: (metadata.youtube_tags || []).slice(0, 15),
          categoryId: '28', // Science & Technology
          defaultLanguage: 'en'
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
          license: 'youtube'
        }
      },
      media: {
        body: fs.createReadStream(videoPath)
      }
    });

    // Update quota tracker
    await Channel.findOneAndUpdate(
      { accountId: channel.accountId },
      { $inc: { quotaUsedToday: this.costPerUpload } }
    );

    log.info(`YouTube upload success: ${res.data.id}`);
    return {
      platformVideoId: res.data.id,
      url: `https://youtube.com/shorts/${res.data.id}`,
      status: 'uploaded'
    };
  }

  /**
   * Post a comment (costs 50 quota units).
   */
  async postComment(platformVideoId, commentText, channel) {
    const auth = await this._getAuthClient(channel);
    const youtube = google.youtube({ version: 'v3', auth });

    const res = await youtube.commentThreads.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          videoId: platformVideoId,
          topLevelComment: {
            snippet: { textOriginal: commentText }
          }
        }
      }
    });

    await Channel.findOneAndUpdate(
      { accountId: channel.accountId },
      { $inc: { quotaUsedToday: 50 } }
    );

    return { commentId: res.data.id, status: 'posted' };
  }

  /**
   * Fetch video metrics (batch-optimized: 1 quota unit per batch of 50 IDs).
   */
  async getMetrics(platformVideoId, channel) {
    const auth = await this._getAuthClient(channel);
    const youtube = google.youtube({ version: 'v3', auth });

    // Support batch: platformVideoId can be comma-separated
    const res = await youtube.videos.list({
      part: 'statistics',
      id: platformVideoId
    });

    await Channel.findOneAndUpdate(
      { accountId: channel.accountId },
      { $inc: { quotaUsedToday: 1 } }
    );

    const item = res.data.items?.[0];
    if (!item) return { views: 0, likes: 0, comments: 0, shares: 0 };

    return {
      views: parseInt(item.statistics.viewCount) || 0,
      likes: parseInt(item.statistics.likeCount) || 0,
      comments: parseInt(item.statistics.commentCount) || 0,
      shares: 0 // YouTube API doesn't expose share count
    };
  }

  /**
   * Check remaining quota (10,000 units/day per project).
   */
  async checkQuota(channel) {
    const ch = await Channel.findOne({ accountId: channel.accountId });
    if (!ch) return { remainingQuota: 10000, resetTime: new Date() };

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    if (!ch.quotaResetAt || ch.quotaResetAt < todayStart) {
      await Channel.findOneAndUpdate(
        { accountId: channel.accountId },
        { quotaUsedToday: 0, quotaResetAt: new Date() }
      );
      return { remainingQuota: 10000, resetTime: todayStart };
    }

    return {
      remainingQuota: 10000 - (ch.quotaUsedToday || 0),
      resetTime: ch.quotaResetAt
    };
  }

  /**
   * Validate YouTube credentials.
   */
  async validateAuth(channel) {
    try {
      const auth = await this._getAuthClient(channel);
      const youtube = google.youtube({ version: 'v3', auth });
      await youtube.channels.list({ part: 'id', mine: true });
      return true;
    } catch (err) {
      log.warn(`YouTube auth validation failed for ${channel.accountId}: ${err.message}`);
      return false;
    }
  }
}

module.exports = YouTubePublisher;
