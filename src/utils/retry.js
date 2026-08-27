'use strict';

const { getModuleLogger } = require('./logger');
const log = getModuleLogger('retry');

/**
 * Exponential backoff retry wrapper.
 * Retries an async function with increasing delays on failure.
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay cap in ms (default: 10000)
 * @param {string} options.name - Operation name for logging (default: 'operation')
 * @returns {Promise<any>} Result of fn
 * @throws {Error} Last error if all retries exhausted
 */
async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    name = 'operation'
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < maxRetries) {
        const jitter = Math.random() * 500;
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1) + jitter, maxDelay);
        log.warn(`${name} attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        log.error(`${name} failed after ${maxRetries} attempts: ${err.message}`);
      }
    }
  }

  throw lastError;
}

module.exports = { withRetry };
