'use strict';

/**
 * seed-channels.js
 *
 * Seeds the MongoDB database with initial channel configurations
 * and affiliate programs. Run once to bootstrap the system.
 *
 * Usage:
 *   node migrations/seed-channels.js              # Dry run (preview)
 *   node migrations/seed-channels.js --apply      # Actually seed
 *   node migrations/seed-channels.js --reset      # Wipe & re-seed
 */

require('dotenv').config();

const { connectToMongoDB, disconnectMongoDB } = require('../src/db/connection');
const { Channel, AffiliateProgram } = require('../src/db/schema');
const { getModuleLogger } = require('../src/utils/logger');

const log = getModuleLogger('seed');

const DRY_RUN = !process.argv.includes('--apply') && !process.argv.includes('--reset');
const RESET = process.argv.includes('--reset');

// ============================================================
// CHANNEL DEFINITIONS
// ============================================================
// Each channel maps to a YouTube/IG account + content vertical.
// Credentials reference env var NAMES (not actual values).
const CHANNELS = [
  {
    accountId: 'tech-main',
    displayName: 'AURA Tech',
    platform: 'youtube',
    verticalId: 'tech',
    contentPersona: 'Enthusiastic tech educator who explains complex topics with simple analogies. '
      + 'Uses "you" frequently, asks rhetorical questions, and always ends with actionable takeaways. '
      + 'Think MKBHD meets 3Blue1Brown in a 50-second format.',
    credentials: {
      clientId: 'YT_TECH_MAIN_CLIENT_ID',
      clientSecret: 'YT_TECH_MAIN_CLIENT_SECRET',
      refreshToken: 'YT_TECH_MAIN_REFRESH_TOKEN'
    },
    subreddits: ['programming', 'MachineLearning', 'webdev', 'technology', 'artificial', 'startups'],
    isActive: true
  },
  {
    accountId: 'history-main',
    displayName: 'AURA History',
    platform: 'youtube',
    verticalId: 'history',
    contentPersona: 'Dramatic storyteller who makes historical events feel like thrillers. '
      + 'Uses vivid imagery, builds tension, and reveals surprising twists. '
      + 'Think Dan Carlin in 50 seconds.',
    credentials: {
      clientId: 'YT_HISTORY_CLIENT_ID',
      clientSecret: 'YT_HISTORY_CLIENT_SECRET',
      refreshToken: 'YT_HISTORY_REFRESH_TOKEN'
    },
    subreddits: ['history', 'HistoryMemes', 'AskHistorians', 'todayilearned'],
    isActive: true
  },
  {
    accountId: 'tech-ig',
    displayName: 'AURA Tech (IG)',
    platform: 'instagram',
    verticalId: 'tech',
    contentPersona: 'Quick-hit tech news with emojis and energy. '
      + 'Fast-paced, visual-first, optimized for Reels discovery. '
      + 'Uses trending sounds references and viral hooks.',
    credentials: {
      accessToken: 'IG_TECH_MAIN_ACCESS_TOKEN',
      clientId: 'IG_TECH_MAIN_USER_ID'
    },
    subreddits: ['technology', 'gadgets', 'startups'],
    isActive: true
  },
  {
    accountId: 'history-ig',
    displayName: 'AURA History (IG)',
    platform: 'instagram',
    verticalId: 'history',
    contentPersona: 'Mind-blowing history facts with dramatic reveal format. '
      + 'Uses "Wait for it..." hooks. Emojis in captions. Visual storytelling.',
    credentials: {
      accessToken: 'IG_HISTORY_ACCESS_TOKEN',
      clientId: 'IG_HISTORY_USER_ID'
    },
    subreddits: ['history', 'todayilearned'],
    isActive: true
  }
];

// ============================================================
// AFFILIATE PROGRAM DEFINITIONS
// ============================================================
const AFFILIATES = [
  {
    programId: 'hostinger',
    displayName: 'Hostinger',
    referralUrl: 'https://www.hostinger.com/aura',
    shortCode: 'AURA',
    ctaText: '🔥 Build your website with Hostinger — use code AURA for 80% off!',
    verticals: ['tech'],
    injectionFrequency: 5,   // 1 in every 5 videos
    isActive: true
  },
  {
    programId: 'nordvpn',
    displayName: 'NordVPN',
    referralUrl: 'https://nordvpn.com/aura',
    shortCode: 'AURA',
    ctaText: '🔒 Protect your privacy with NordVPN — link in description!',
    verticals: ['tech', 'geopolitics'],
    injectionFrequency: 7,
    isActive: true
  },
  {
    programId: 'brilliant',
    displayName: 'Brilliant',
    referralUrl: 'https://brilliant.org/aura',
    shortCode: 'AURA',
    ctaText: '🧠 Level up your thinking with Brilliant — first 200 get 20% off!',
    verticals: ['tech', 'science', 'history'],
    injectionFrequency: 6,
    isActive: true
  },
  {
    programId: 'skillshare',
    displayName: 'Skillshare',
    referralUrl: 'https://skillshare.com/aura',
    shortCode: 'AURA',
    ctaText: '🎨 Learn anything on Skillshare — first month free with link below!',
    verticals: ['tech', 'history', 'science'],
    injectionFrequency: 8,
    isActive: true
  }
];

// ============================================================
// MAIN
// ============================================================
async function main() {
  await connectToMongoDB();

  console.log(`\nMode: ${RESET ? 'RESET + SEED' : DRY_RUN ? 'DRY RUN' : 'SEED'}\n`);

  if (RESET) {
    log.info('Resetting channels and affiliates...');
    await Channel.deleteMany({});
    await AffiliateProgram.deleteMany({});
    log.info('Collections cleared.');
  }

  // Seed channels
  log.info(`\nSeeding ${CHANNELS.length} channels...`);
  for (const ch of CHANNELS) {
    if (DRY_RUN) {
      log.info(`  [DRY] Would create: ${ch.accountId} (${ch.platform}/${ch.verticalId})`);
    } else {
      try {
        await Channel.findOneAndUpdate(
          { accountId: ch.accountId },
          ch,
          { upsert: true, new: true }
        );
        log.info(`  ✅ ${ch.accountId} (${ch.platform}/${ch.verticalId})`);
      } catch (err) {
        log.warn(`  ❌ ${ch.accountId}: ${err.message}`);
      }
    }
  }

  // Seed affiliates
  log.info(`\nSeeding ${AFFILIATES.length} affiliate programs...`);
  for (const aff of AFFILIATES) {
    if (DRY_RUN) {
      log.info(`  [DRY] Would create: ${aff.programId} (${aff.verticals.join(', ')})`);
    } else {
      try {
        await AffiliateProgram.findOneAndUpdate(
          { programId: aff.programId },
          aff,
          { upsert: true, new: true }
        );
        log.info(`  ✅ ${aff.programId} → ${aff.verticals.join(', ')}`);
      } catch (err) {
        log.warn(`  ❌ ${aff.programId}: ${err.message}`);
      }
    }
  }

  // Verify
  if (!DRY_RUN) {
    const chCount = await Channel.countDocuments();
    const affCount = await AffiliateProgram.countDocuments();
    log.info(`\n✅ Database: ${chCount} channels, ${affCount} affiliate programs`);
  } else {
    log.info('\n(Dry run — no changes made. Use --apply to seed.)');
  }

  await disconnectMongoDB();
}

main().catch(err => {
  log.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
