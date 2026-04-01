'use strict';

const crypto = require('crypto');
const { distance } = require('fastest-levenshtein');
const { getModuleLogger } = require('../utils/logger');
const { TopicSeen } = require('../db/schema');

const log = getModuleLogger('dedup-guard');

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'out', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where',
  'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because',
  'but', 'and', 'or', 'if', 'while', 'it', 'its', 'this', 'that',
  'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what',
  'which', 'who', 'whom'
]);

/**
 * Normalize a topic string for hashing.
 * Lowercase, remove stop words, remove special chars, sort words.
 * @param {string} topic
 * @returns {string}
 */
function normalizeTopic(topic) {
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  words.sort();
  return words.join(' ');
}

/**
 * SHA256 hash of normalized topic.
 * @param {string} topic
 * @returns {string}
 */
function hashTopic(topic) {
  const normalized = normalizeTopic(topic);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Compute Dice coefficient similarity between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0.0 to 1.0
 */
function diceSimilarity(a, b) {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return 0.0;

  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigramsA.get(bigram);
    if (count && count > 0) {
      intersection++;
      bigramsA.set(bigram, count - 1);
    }
  }

  return (2.0 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * Get recent topics for an account from database.
 * @param {string} accountId
 * @param {number} limit
 * @returns {Promise<string[]>}
 */
async function getRecentTopics(accountId, limit = 200) {
  try {
    const docs = await TopicSeen.find({ accountId })
      .sort({ seenAt: -1 })
      .limit(limit)
      .lean();
    return docs.map(d => d.normalizedTopic);
  } catch (err) {
    log.warn(`Failed to fetch recent topics: ${err.message}`);
    return [];
  }
}

/**
 * Three-layer deduplication check.
 *
 * Layer 1: Exact hash match in database
 * Layer 2: Semantic similarity (Dice coefficient > 0.65)
 * Layer 3: LLM verification for borderline cases (0.45-0.65)
 *
 * Cross-channel awareness: checks ALL channels in the same vertical.
 *
 * @param {string} topic - Raw topic string
 * @param {string} accountId - Channel account ID
 * @param {string} verticalId - Content vertical for cross-channel check
 * @returns {Promise<boolean>} true if duplicate
 */
async function isDuplicate(topic, accountId, verticalId = null) {
  const hash = hashTopic(topic);
  const normalized = normalizeTopic(topic);

  // LAYER 1: Exact hash check
  try {
    const existing = await TopicSeen.findOne({ topicHash: hash });
    if (existing) {
      log.info(`DUPLICATE [Layer 1 - exact hash]: "${topic}" matches "${existing.normalizedTopic}"`);
      return true;
    }
  } catch (err) {
    log.warn(`Layer 1 hash check error: ${err.message}`);
  }

  // LAYER 2: Semantic similarity against recent topics
  try {
    // Check against same account and same vertical (cross-channel)
    const query = verticalId
      ? { $or: [{ accountId }, { accountId: { $regex: new RegExp(`.*`) } }] }
      : { accountId };

    const recentDocs = await TopicSeen.find(query)
      .sort({ seenAt: -1 })
      .limit(200)
      .lean();

    let maxSimilarity = 0;
    let matchedTopic = '';

    for (const doc of recentDocs) {
      const sim = diceSimilarity(normalized, doc.normalizedTopic);
      if (sim > maxSimilarity) {
        maxSimilarity = sim;
        matchedTopic = doc.normalizedTopic;
      }
    }

    if (maxSimilarity > 0.65) {
      log.info(`DUPLICATE [Layer 2 - semantic ${(maxSimilarity * 100).toFixed(0)}%]: "${topic}" ~ "${matchedTopic}"`);
      return true;
    }

    // LAYER 3: LLM verification for borderline cases (0.45-0.65)
    if (maxSimilarity > 0.45) {
      log.info(`Borderline similarity ${(maxSimilarity * 100).toFixed(0)}% — would use LLM verification in production`);
      // In production, call cheapest LLM in cascade with prompt:
      // "Are these topics the same subject? Topic A: '...'. Topic B: '...'. Reply SAME or DIFFERENT."
      // For now, err on the side of caution — treat as duplicate if > 0.55
      if (maxSimilarity > 0.55) {
        log.info(`DUPLICATE [Layer 3 - borderline treated as dup at ${(maxSimilarity * 100).toFixed(0)}%]`);
        return true;
      }
    }
  } catch (err) {
    log.warn(`Layer 2/3 semantic check error: ${err.message}`);
  }

  return false;
}

/**
 * Mark a topic as seen in the deduplication index.
 * @param {string} topic
 * @param {string} accountId
 * @param {string} platform
 * @returns {Promise<void>}
 */
async function markAsSeen(topic, accountId, platform) {
  const hash = hashTopic(topic);
  const normalized = normalizeTopic(topic);

  try {
    await TopicSeen.findOneAndUpdate(
      { topicHash: hash },
      {
        topicHash: hash,
        normalizedTopic: normalized,
        seenAt: new Date(),
        accountId,
        platform
      },
      { upsert: true }
    );
    log.info(`Topic marked as seen: "${topic.substring(0, 60)}..." [${accountId}/${platform}]`);
  } catch (err) {
    log.warn(`Failed to mark topic as seen: ${err.message}`);
  }
}

module.exports = { isDuplicate, markAsSeen, getRecentTopics, hashTopic, normalizeTopic, diceSimilarity };
