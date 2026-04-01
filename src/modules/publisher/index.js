'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../../utils/logger');

const log = getModuleLogger('publisher-loader');

/**
 * Plugin loader — auto-discovers all publisher plugins in this directory.
 * Adding a new platform requires ONLY creating a new .js file here.
 */
const plugins = {};

const ignoreFiles = new Set(['index.js', 'base-publisher.js']);
const pluginDir = __dirname;

const files = fs.readdirSync(pluginDir).filter(f =>
  f.endsWith('.js') && !ignoreFiles.has(f)
);

for (const file of files) {
  try {
    const PluginClass = require(path.join(pluginDir, file));
    // Handle both class exports and instance exports
    const instance = typeof PluginClass === 'function' ? new PluginClass() : PluginClass;
    if (instance.platform) {
      plugins[instance.platform] = instance;
      log.info(`Loaded publisher plugin: ${instance.platform} (${file})`);
    }
  } catch (err) {
    log.warn(`Failed to load plugin ${file}: ${err.message}`);
  }
}

/**
 * Get a publisher plugin instance by platform name.
 * @param {string} platform
 * @returns {BasePublisher|null}
 */
function getPublisherPlugin(platform) {
  return plugins[platform] || null;
}

/**
 * List all loaded publisher plugins.
 * @returns {string[]}
 */
function listPlugins() {
  return Object.keys(plugins);
}

/**
 * Publish a video to one or more channels.
 * @param {string} videoPath
 * @param {Object} metadata
 * @param {Array} channels
 * @returns {Promise<Array>}
 */
async function publish(videoPath, metadata, channels) {
  const results = [];

  for (const channel of channels) {
    const plugin = plugins[channel.platform];
    if (!plugin) {
      log.warn(`No plugin for platform: ${channel.platform}`);
      results.push({ channel: channel.accountId, status: 'skipped', error: 'No plugin' });
      continue;
    }

    try {
      const quota = await plugin.checkQuota(channel);
      if (quota.remainingQuota < plugin.costPerUpload) {
        log.warn(`${channel.platform}/${channel.accountId}: quota exhausted`);
        results.push({ channel: channel.accountId, status: 'quota_exhausted' });
        continue;
      }

      const result = await plugin.upload(videoPath, metadata, channel);
      results.push({ channel: channel.accountId, ...result });
    } catch (err) {
      log.error(`Upload failed for ${channel.accountId}: ${err.message}`);
      results.push({ channel: channel.accountId, status: 'failed', error: err.message });
    }
  }

  return results;
}

module.exports = { getPublisherPlugin, listPlugins, publish, plugins };
