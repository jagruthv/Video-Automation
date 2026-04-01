'use strict';
const BasePublisher = require('./base-publisher');
const { getModuleLogger } = require('../../utils/logger');
const log = getModuleLogger('tiktok-publisher');

class TikTokPublisher extends BasePublisher {
  constructor() { super(); this.platform = 'tiktok'; this.costPerUpload = 1; }
  async upload() { throw new Error('TikTok plugin not yet implemented — use Content Posting API v2'); }
  async postComment() { throw new Error('Not implemented'); }
  async getMetrics() { return { views: 0, likes: 0, comments: 0, shares: 0 }; }
  async checkQuota() { return { remainingQuota: 100, resetTime: new Date() }; }
  async validateAuth() { return false; }
}
module.exports = TikTokPublisher;
