'use strict';

/**
 * BasePublisher — Interface contract for all platform publisher plugins.
 * Every publisher must extend this class and implement all methods.
 */
class BasePublisher {
  constructor() {
    this.platform = '';
    this.costPerUpload = 0;
  }

  /** Upload a video. @returns {{platformVideoId, url, status}} */
  async upload(videoPath, metadata, channel) {
    throw new Error(`upload() not implemented for ${this.platform}`);
  }

  /** Post a comment on uploaded video. @returns {{commentId, status}} */
  async postComment(platformVideoId, commentText, channel) {
    throw new Error(`postComment() not implemented for ${this.platform}`);
  }

  /** Fetch metrics. @returns {{views, likes, comments, shares}} */
  async getMetrics(platformVideoId, channel) {
    throw new Error(`getMetrics() not implemented for ${this.platform}`);
  }

  /** Check remaining quota. @returns {{remainingQuota, resetTime}} */
  async checkQuota(channel) {
    throw new Error(`checkQuota() not implemented for ${this.platform}`);
  }

  /** Validate credentials. @returns {boolean} */
  async validateAuth(channel) {
    throw new Error(`validateAuth() not implemented for ${this.platform}`);
  }
}

module.exports = BasePublisher;
