'use strict';
const BasePublisher = require('./base-publisher');
const { getModuleLogger } = require('../../utils/logger');
const log = getModuleLogger('x-twitter-publisher');

class XTwitterPublisher extends BasePublisher {
  constructor() { super(); this.platform = 'x'; this.costPerUpload = 1; }
  async upload() { throw new Error('X/Twitter plugin not yet implemented — drop in OAuth 1.0a + media upload'); }
  async postComment() { throw new Error('Not implemented'); }
  async getMetrics() { return { views: 0, likes: 0, comments: 0, shares: 0 }; }
  async checkQuota() { return { remainingQuota: 100, resetTime: new Date() }; }
  async validateAuth() { return false; }
}
module.exports = XTwitterPublisher;
