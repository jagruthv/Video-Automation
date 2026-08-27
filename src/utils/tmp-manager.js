'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('./logger');
const log = getModuleLogger('tmp-manager');

/**
 * Manages the /tmp/build directory lifecycle.
 * Creates at pipeline start, destroys at pipeline end (even on error).
 */
class TmpManager {
  /**
   * @param {string} basePath - Base temp directory path
   */
  constructor(basePath = '/tmp/build') {
    this.basePath = basePath;
  }

  /**
   * Create the temp directory structure.
   */
  create() {
    try {
      fs.mkdirSync(this.basePath, { recursive: true });
      fs.mkdirSync(path.join(this.basePath, 'clips'), { recursive: true });
      fs.mkdirSync(path.join(this.basePath, 'audio'), { recursive: true });
      fs.mkdirSync(path.join(this.basePath, 'output'), { recursive: true });
      log.info(`Temp directory created: ${this.basePath}`);
    } catch (err) {
      log.error(`Failed to create temp directory: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get a full path within the temp directory.
   * @param {string} filename
   * @returns {string}
   */
  path(filename) {
    return path.join(this.basePath, filename);
  }

  /**
   * Get path within a subdirectory.
   * @param {string} subdir - Subdirectory name (clips, audio, output)
   * @param {string} filename
   * @returns {string}
   */
  subpath(subdir, filename) {
    return path.join(this.basePath, subdir, filename);
  }

  /**
   * Destroy the temp directory and all contents.
   */
  destroy() {
    try {
      fs.rmSync(this.basePath, { recursive: true, force: true });
      log.info(`Temp directory cleaned up: ${this.basePath}`);
    } catch (err) {
      log.warn(`Temp cleanup failed (non-critical): ${err.message}`);
    }
  }

  /**
   * Get total size of all files in temp directory in bytes.
   * @returns {number}
   */
  getSize() {
    try {
      let totalSize = 0;
      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else {
            totalSize += fs.statSync(full).size;
          }
        }
      };
      walk(this.basePath);
      return totalSize;
    } catch {
      return 0;
    }
  }

  /**
   * Get human-readable size string.
   * @returns {string}
   */
  getSizeHuman() {
    const bytes = this.getSize();
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}

module.exports = TmpManager;
