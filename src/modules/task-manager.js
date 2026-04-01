'use strict';

const { getModuleLogger } = require('../utils/logger');
const { Task } = require('../db/schema');
const { discoverTopics } = require('./topic-intelligence');
const { isDuplicate } = require('./deduplication-guard');

const log = getModuleLogger('task-manager');

/**
 * Get the next video job for a channel.
 * Priority 1: Manually created tasks from the dashboard.
 * Priority 2: Auto-discovered trending topics.
 *
 * @param {string} accountId
 * @param {string} verticalId
 * @param {string[]} customSubreddits
 * @returns {Promise<{source, topic, additionalContext?, taskId?, sourceUrl?, viralityScore?, affiliatePotential?}|null>}
 */
async function getNextVideoJob(accountId, verticalId, customSubreddits = []) {
  // Priority 1: Check for manually created tasks
  const manualTask = await Task.findOneAndUpdate(
    {
      status: 'pending',
      $or: [
        { accountId },
        { accountId: 'any' } // Tasks targeting any account
      ],
      verticalId
    },
    { status: 'picked', pickedAt: new Date() },
    { sort: { priority: -1, createdAt: 1 }, new: true }
  );

  if (manualTask) {
    log.info(`Manual task found: "${manualTask.topicInstruction}" (priority: ${manualTask.priority})`);
    return {
      source: 'manual',
      topic: manualTask.topicInstruction,
      additionalContext: manualTask.additionalContext,
      taskId: manualTask._id
    };
  }

  // Priority 2: Auto-discover
  log.info(`No manual tasks — discovering topics for ${verticalId}...`);
  const topics = await discoverTopics(verticalId, 15, customSubreddits);

  // Filter through deduplication
  for (const t of topics) {
    const dup = await isDuplicate(t.topic, accountId, verticalId);
    if (!dup) {
      log.info(`Auto-discovered topic: "${t.topic}" (score: ${t.viralityScore})`);
      return {
        source: 'auto',
        topic: t.topic,
        sourceUrl: t.sourceUrl,
        viralityScore: t.viralityScore,
        affiliatePotential: t.affiliatePotential
      };
    }
    log.info(`Duplicate skipped: "${t.topic.substring(0, 50)}..."`);
  }

  log.warn(`No unique topics found for ${accountId}/${verticalId}`);
  return null;
}

/**
 * Mark a manual task as completed.
 */
async function completeTask(taskId, videoRecordId = null) {
  await Task.findByIdAndUpdate(taskId, {
    status: 'done',
    completedAt: new Date(),
    resultVideoId: videoRecordId
  });
}

/**
 * Mark a manual task as failed.
 */
async function failTask(taskId, reason = '') {
  await Task.findByIdAndUpdate(taskId, {
    status: 'failed',
    completedAt: new Date(),
    additionalContext: reason
  });
}

module.exports = { getNextVideoJob, completeTask, failTask };
