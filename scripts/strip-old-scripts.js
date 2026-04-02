'use strict';

/**
 * strip-old-scripts.js
 *
 * Scheduled cleanup: removes scriptJson blobs from VideoRecord documents
 * older than 60 days to save MongoDB storage.
 *
 * The scriptJson field can be 2-5 KB per video. At 30 videos/day,
 * that's ~90 KB/day → ~3.3 MB/month retained forever without cleanup.
 *
 * Keeps: topic, youtube_title, youtube_tags (for analytics).
 * Removes: hook, body, full_script, visual_*, instagram_caption, etc.
 *
 * Usage:
 *   node scripts/strip-old-scripts.js          # dry run
 *   node scripts/strip-old-scripts.js --apply  # actually strip
 *
 * Called weekly by .github/workflows/cleanup.yml
 */

require('dotenv').config();

const { connectToMongoDB, disconnectMongoDB } = require('../src/db/connection');
const { VideoRecord } = require('../src/db/schema');
const { getModuleLogger } = require('../src/utils/logger');

const log = getModuleLogger('strip-old-scripts');

const DRY_RUN = !process.argv.includes('--apply');
const RETENTION_DAYS = parseInt(process.env.SCRIPT_RETENTION_DAYS) || 60;

// Fields to KEEP from scriptJson (for analytics / search)
const KEEP_FIELDS = ['youtube_title', 'youtube_tags', 'mood', 'estimated_reading_time_seconds'];

async function main() {
  await connectToMongoDB();

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  log.info(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  log.info(`Stripping scriptJson from videos older than ${RETENTION_DAYS} days (before ${cutoff.toISOString()})`);

  // Find candidates
  const candidates = await VideoRecord.find({
    createdAt: { $lt: cutoff },
    scriptJson: { $ne: null },
    'scriptJson.full_script': { $exists: true }  // Only unstripped ones
  }).select('_id topic scriptJson createdAt').lean();

  log.info(`Found ${candidates.length} video(s) eligible for stripping`);

  if (candidates.length === 0) {
    log.info('Nothing to strip — exiting');
    await disconnectMongoDB();
    return;
  }

  let stripped = 0;
  let errors = 0;
  let savedBytes = 0;

  for (const video of candidates) {
    try {
      const original = JSON.stringify(video.scriptJson || {});
      const originalSize = Buffer.byteLength(original, 'utf8');

      // Build stripped version — keep only analytics-relevant fields
      const strippedScript = {};
      for (const field of KEEP_FIELDS) {
        if (video.scriptJson[field] !== undefined) {
          strippedScript[field] = video.scriptJson[field];
        }
      }
      strippedScript._stripped = true;
      strippedScript._strippedAt = new Date().toISOString();

      const newSize = Buffer.byteLength(JSON.stringify(strippedScript), 'utf8');
      const saved = originalSize - newSize;

      if (DRY_RUN) {
        log.info(`  [DRY] ${video._id} — "${video.topic?.substring(0, 40)}..." — would save ${saved} bytes`);
      } else {
        await VideoRecord.findByIdAndUpdate(video._id, { scriptJson: strippedScript });
        log.info(`  Stripped ${video._id} — saved ${saved} bytes`);
      }

      stripped++;
      savedBytes += saved;
    } catch (err) {
      errors++;
      log.warn(`  Error on ${video._id}: ${err.message}`);
    }
  }

  log.info(`\n${'='.repeat(40)}`);
  log.info(`Stripped: ${stripped} / ${candidates.length}`);
  log.info(`Errors:   ${errors}`);
  log.info(`Saved:    ${(savedBytes / 1024).toFixed(1)} KB`);
  if (DRY_RUN) log.info('(Dry run — no changes made. Use --apply to execute.)');
  log.info('='.repeat(40));

  await disconnectMongoDB();
}

main().catch(err => {
  log.error(`Fatal: ${err.message}`);
  process.exit(1);
});
