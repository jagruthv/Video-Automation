'use strict';

const fs = require('fs');
const FormData = require('form-data');
const BasePublisher = require('./base-publisher');
const { getModuleLogger } = require('../../utils/logger');
const { Channel } = require('../../db/schema');

const log = getModuleLogger('instagram-publisher');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class InstagramPublisher extends BasePublisher {
  constructor() {
    super();
    this.platform = 'instagram';
    this.costPerUpload = 1;
  }

  /**
   * Upload video to a temporary public URL.
   * Instagram Graph API requires a publicly accessible video_url.
   *
   * Strategy: Try tmpfiles.org as lightweight option (no key needed),
   * then fall back to a direct URL if provided.
   */
  async _uploadToTempHost(videoPath) {
    // Option 1: tmpfiles.org (free, no key, auto-expires)
    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(videoPath));
      const res = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60000)
      });
      const data = await res.json();
      if (data?.data?.url) {
        // Convert to direct download link
        const directUrl = data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
        log.info(`Temp upload via tmpfiles.org: ${directUrl}`);
        return directUrl;
      }
      throw new Error('tmpfiles.org returned no URL');
    } catch (err) {
      log.warn(`tmpfiles.org failed: ${err.message}`);
    }

    // Option 2: Supabase Storage (if configured)
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      try {
        const bucket = process.env.SUPABASE_BUCKET || 'aura-temp';
        const fileName = `temp_${Date.now()}.mp4`;
        const fileBuffer = fs.readFileSync(videoPath);

        const res = await fetch(
          `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${fileName}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
              'Content-Type': 'video/mp4'
            },
            body: fileBuffer,
            signal: AbortSignal.timeout(60000)
          }
        );

        if (res.ok) {
          const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${fileName}`;
          log.info(`Temp upload via Supabase: ${publicUrl}`);
          return publicUrl;
        }
        throw new Error(`Supabase upload HTTP ${res.status}`);
      } catch (err) {
        log.warn(`Supabase upload failed: ${err.message}`);
      }
    }

    throw new Error('No temporary hosting available for Instagram upload. Configure SUPABASE_URL or use tmpfiles.org.');
  }

  /**
   * Upload a Reel to Instagram via Graph API.
   * 3-step process: create container → poll status → publish.
   */
  async upload(videoPath, metadata, channel) {
    const accessToken = process.env[channel.credentials.accessToken];
    const userId = process.env[channel.credentials.clientId]; // IG user ID

    if (!accessToken || !userId) {
      throw new Error(`Missing Instagram credentials for ${channel.accountId}`);
    }

    // Step 0: Upload to temp public URL
    const publicUrl = await this._uploadToTempHost(videoPath);

    // Step 1: Create media container
    const caption = [
      metadata.instagram_caption || metadata.youtube_title || '',
      metadata.affiliateCTA || ''
    ].filter(Boolean).join('\n\n');

    const createRes = await fetch(
      `https://graph.facebook.com/v25.0/${userId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'REELS',
          video_url: publicUrl,
          caption: caption.substring(0, 2200),
          share_to_feed: true,
          access_token: accessToken
        }),
        signal: AbortSignal.timeout(30000)
      }
    );

    const createData = await createRes.json();
    if (createData.error) throw new Error(`IG container error: ${createData.error.message}`);
    const creationId = createData.id;
    if (!creationId) throw new Error('No creation ID returned from Instagram');

    log.info(`Instagram container created: ${creationId}`);

    // Step 2: Poll until processing complete (max 150 seconds)
    let status = 'IN_PROGRESS';
    let attempts = 0;
    while (status !== 'FINISHED' && attempts < 30) {
      await sleep(5000);
      const pollRes = await fetch(
        `https://graph.facebook.com/v25.0/${creationId}?fields=status_code&access_token=${accessToken}`,
        { signal: AbortSignal.timeout(10000) }
      );
      const pollData = await pollRes.json();
      status = pollData.status_code;

      if (status === 'ERROR') throw new Error('Instagram media processing failed');
      log.info(`Instagram processing: ${status} (attempt ${attempts + 1})`);
      attempts++;
    }

    if (status !== 'FINISHED') throw new Error(`Instagram processing timed out (status: ${status})`);

    // Step 3: Publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v25.0/${userId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: accessToken
        }),
        signal: AbortSignal.timeout(30000)
      }
    );

    const publishData = await publishRes.json();
    if (publishData.error) throw new Error(`IG publish error: ${publishData.error.message}`);
    const mediaId = publishData.id;

    await Channel.findOneAndUpdate(
      { accountId: channel.accountId },
      { $inc: { quotaUsedToday: 1 } }
    );

    log.info(`Instagram Reel published: ${mediaId}`);
    return {
      platformVideoId: mediaId,
      url: `https://www.instagram.com/reel/${mediaId}/`,
      status: 'uploaded'
    };
  }

  async postComment(platformVideoId, commentText, channel) {
    const accessToken = process.env[channel.credentials.accessToken];
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${platformVideoId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commentText,
          access_token: accessToken
        }),
        signal: AbortSignal.timeout(15000)
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(`IG comment error: ${data.error.message}`);
    return { commentId: data.id, status: 'posted' };
  }

  async getMetrics(platformVideoId, channel) {
    const accessToken = process.env[channel.credentials.accessToken];
    try {
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${platformVideoId}/insights?metric=plays,likes,comments,shares&access_token=${accessToken}`,
        { signal: AbortSignal.timeout(10000) }
      );
      const data = await res.json();
      const metrics = {};
      (data.data || []).forEach(m => { metrics[m.name] = m.values?.[0]?.value || 0; });
      return {
        views: metrics.plays || 0,
        likes: metrics.likes || 0,
        comments: metrics.comments || 0,
        shares: metrics.shares || 0
      };
    } catch (err) {
      log.warn(`IG metrics fetch failed: ${err.message}`);
      return { views: 0, likes: 0, comments: 0, shares: 0 };
    }
  }

  async checkQuota(channel) {
    const ch = await Channel.findOne({ accountId: channel.accountId });
    if (!ch) return { remainingQuota: 25, resetTime: new Date() };

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    if (!ch.quotaResetAt || ch.quotaResetAt < todayStart) {
      await Channel.findOneAndUpdate(
        { accountId: channel.accountId },
        { quotaUsedToday: 0, quotaResetAt: new Date() }
      );
      return { remainingQuota: 25, resetTime: todayStart };
    }
    return {
      remainingQuota: 25 - (ch.quotaUsedToday || 0),
      resetTime: ch.quotaResetAt
    };
  }

  async validateAuth(channel) {
    try {
      const token = process.env[channel.credentials.accessToken];
      const res = await fetch(
        `https://graph.facebook.com/v25.0/me?access_token=${token}`,
        { signal: AbortSignal.timeout(10000) }
      );
      return res.ok;
    } catch { return false; }
  }
}

module.exports = InstagramPublisher;
