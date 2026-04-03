'use strict';

require('dotenv').config();

const { v4: uuidv4 } = require('uuid');
const { getModuleLogger } = require('./utils/logger');
const { connectToMongoDB, disconnectMongoDB } = require('./db/connection');
const { VideoRecord, Channel, SystemLog } = require('./db/schema');
const { hashTopic } = require('./modules/deduplication-guard');
const { markAsSeen } = require('./modules/deduplication-guard');
const { generateScript } = require('./modules/llm-cascade');
const { generateVoice } = require('./modules/voice-engine');
const { acquireVisuals } = require('./modules/visual-engine');
const { assembleVideo } = require('./modules/assembly-engine');
const { computeUniquenessScore, getOrCreateTodaySchedule, markSlotUsed } = require('./modules/anti-flag-engine');
const { getPublisherPlugin } = require('./modules/publisher/index');
const { selectAffiliateForVideo, injectAffiliateComment } = require('./modules/affiliate-engine');
const { getNextVideoJob, completeTask, failTask } = require('./modules/task-manager');
const TmpManager = require('./utils/tmp-manager');

const log = getModuleLogger('orchestrator');

/**
 * MAIN PIPELINE ORCHESTRATOR
 *
 * Called by GitHub Actions cron (6x/day) or manually.
 * For each active channel with an available upload slot:
 *   discover → script → voice → visuals → assemble → anti-flag → publish → affiliate
 */
async function main() {
  const runId = uuidv4();
  const tmpManager = new TmpManager('/tmp/build');
  const isDryRun = process.argv.includes('--dry-run');
  const forceNow = process.argv.includes('--force-now');

  try {
    // 0. Initialize
    await connectToMongoDB();
    tmpManager.create();
    log.info(`Pipeline run ${runId} started`);

    if (!isDryRun) {
      await SystemLog.create({
        runId, event: 'pipeline_start', module: 'orchestrator',
        level: 'info', payload: { startTime: new Date() }, timestamp: new Date()
      });
    }

    // 1. Get all active channels
    const channels = await Channel.find({ isActive: true });
    log.info(`Found ${channels.length} active channel(s)`);

    if (channels.length === 0) {
      log.warn('No active channels configured — nothing to do');
      return;
    }

    let totalPublished = 0;
    let totalFailed = 0;

    for (const channel of channels) {
      try {
        log.info(`\n${'='.repeat(60)}\nProcessing channel: ${channel.accountId} (${channel.platform}/${channel.verticalId})\n${'='.repeat(60)}`);

        // 2. Check quota
        const plugin = getPublisherPlugin(channel.platform);
        if (!plugin) {
          log.warn(`No publisher plugin for ${channel.platform} — skipping ${channel.accountId}`);
          continue;
        }

        const quota = await plugin.checkQuota(channel);
        if (!isDryRun && quota.remainingQuota < plugin.costPerUpload) {
          log.info(`${channel.accountId}: Quota exhausted (${quota.remainingQuota} remaining). Skipping.`);
          continue;
        }

        // 3. Check upload schedule — is there an available slot now?
        const schedule = await getOrCreateTodaySchedule(channel.accountId);
        const now = new Date();
        const nextSlot = schedule.find(s => !s.used && s.time <= now);
        if (!isDryRun && !forceNow && !nextSlot) {
          const futureSlots = schedule.filter(s => !s.used && s.time > now);
          if (futureSlots.length > 0) {
            log.info(`${channel.accountId}: No slot ready now. Next at ${futureSlots[0].time.toISOString()}`);
          } else {
            log.info(`${channel.accountId}: All slots used for today`);
          }
          continue;
        }

        if (isDryRun) {
          log.info(`Dry Run activated: Bypassing quota and schedule slot checking.`);
        } else if (forceNow) {
          log.info(`Upload slot forcefully bypassed via --force-now flag.`);
        } else {
          log.info(`Upload slot available: ${nextSlot.time.toISOString()}`);
        }

        // 4. Get next video job (manual task or auto-discovery)
        const recentTopics = channel.stats && channel.stats.recentTopics ? channel.stats.recentTopics : [];
        const job = await getNextVideoJob(
          channel.accountId,
          channel.verticalId,
          channel.subreddits || [],
          recentTopics
        );

        if (!job) {
          log.warn(`${channel.accountId}: No viable topic found — skipping`);
          continue;
        }

        log.info(`Topic: "${job.topic}" (source: ${job.source})`);

        // 5. Generate script via LLM cascade
        log.info('Generating script...');
        const { script, provider: llmProvider } = await generateScript(
          job.topic,
          channel.verticalId,
          channel.contentPersona,
          { source: job.source, sourceUrl: job.sourceUrl, viralityScore: job.viralityScore }
        );
        log.info(`Script generated via ${llmProvider}: "${script.youtubeTitle || script.youtube_title || job.topic}"`);

        // 6. Generate voice audio
        log.info('Generating voice...');
        const voiceResult = await generateVoice(script.script, {
          accountId: channel.accountId,
          outputPath: tmpManager.subpath('audio', 'voice.mp3')
        });
        log.info(`Voice: ${voiceResult.provider} (${voiceResult.voice}), ${voiceResult.durationMs}ms`);

        // 7. Acquire background visuals
        log.info('Acquiring visuals...');
        const visuals = await acquireVisuals(
          script,
          voiceResult.durationMs,
          tmpManager.subpath('clips', '')
        );
        log.info(`Visuals: ${visuals.clips.length} clips from ${visuals.provider}`);

        // 8. Assemble final video
        log.info('Assembling video...');
        const assembly = await assembleVideo(
          voiceResult.audioPath,
          visuals.clips,
          voiceResult.wordTimestamps,
          { addAmbientNoise: true }
        );
        log.info(`Video assembled: ${assembly.durationSeconds}s, ${assembly.fileSizeMB}MB`);

        // 9. Create video record and compute uniqueness
        let videoRecord;
        if (!isDryRun) {
          videoRecord = await VideoRecord.create({
            accountId: channel.accountId,
            verticalId: channel.verticalId,
            platform: channel.platform,
            topic: job.topic,
            topicHash: hashTopic(job.topic),
            scriptJson: script,
            llmProvider,
            ttsProvider: voiceResult.provider,
            ttsVoice: voiceResult.voice,
            visualProvider: visuals.provider,
            status: 'processing'
          });
        } else {
          videoRecord = {
            _id: 'dry-run-id',
            accountId: channel.accountId,
            verticalId: channel.verticalId,
            platform: channel.platform,
            topic: job.topic,
            topicHash: hashTopic(job.topic),
            scriptJson: script,
            llmProvider,
            visualProvider: visuals.provider
          };
          log.info('DRY RUN: Skipped database VideoRecord creation');
        }

        const uniquenessScore = await computeUniquenessScore(videoRecord);
        log.info(`Uniqueness score (Analytics only): ${uniquenessScore}/100`);

        // 10. Select affiliate (if applicable)
        const affiliateData = await selectAffiliateForVideo(videoRecord);
        if (affiliateData) {
          log.info(`Affiliate: ${affiliateData.programId}`);
        }

        // Normalize LLM output keys → publisher-expected keys
        // LLM outputs camelCase: youtubeTitle, youtubeDescription
        // Publisher expects snake_case: youtube_title, youtube_description, youtube_tags
        const extractHashtags = (text = '') =>
          (text.match(/#[A-Za-z0-9_]+/g) || []).slice(0, 15);

        const metadata = {
          ...script,
          // Explicit mapping — works regardless of casing from any LLM
          youtube_title:       script.youtubeTitle       || script.youtube_title       || `${job.topic} #shorts`,
          youtube_description: script.youtubeDescription || script.youtube_description || '',
          // Prefer the LLM's explicit tags array, fall back to hashtag extraction from description
          youtube_tags:        script.tags               || script.youtube_tags        || extractHashtags(script.youtubeDescription || script.youtube_description || ''),
          affiliateCTA:        affiliateData?.ctaForDescription || '',
          attributions:        visuals.attributions || []
        };

        // 11. Publish!
        log.info(`Publishing to ${channel.platform}...`);
        const publishResult = await plugin.upload(assembly.videoPath, metadata, channel, { isDryRun });
        log.info(`Published: ${publishResult.url} (ID: ${publishResult.platformVideoId})`);

        // 12. Update video record & Channel recentTopics
        if (!isDryRun) {
          await VideoRecord.findByIdAndUpdate(videoRecord._id, {
            videoId: publishResult.platformVideoId,
            status: publishResult.status || 'uploaded',
            uploadDate: new Date(),
            uniquenessScore,
            affiliateLinksUsed: affiliateData ? [affiliateData.programId] : []
          });

          await Channel.findByIdAndUpdate(channel._id, {
            $push: {
              'stats.recentTopics': {
                $each: [job.topic],
                $slice: -30
              }
            }
          });

          // 13. Mark topic as seen
          await markAsSeen(job.topic, channel.accountId, channel.platform);

          // 14. Post affiliate comment (with natural delay)
          if (affiliateData) {
            await injectAffiliateComment(publishResult, affiliateData, channel);
          }

          // 15. Mark schedule slot as used
          if (nextSlot) {
            await markSlotUsed(channel.accountId, nextSlot, videoRecord._id);
          }

          // 16. Mark manual task as done
          if (job.source === 'manual' && job.taskId) {
            await completeTask(job.taskId, videoRecord._id);
          }
        } else {
          log.info('DRY RUN: Skipped updating DB records, channel stats, marking slots, and posting comments.');
        }

        totalPublished++;
        log.info(`✅ Video published successfully: ${publishResult.url}`);

        if (!isDryRun) {
          await SystemLog.create({
            runId, event: 'video_published', module: 'orchestrator',
            level: 'info',
            payload: {
              accountId: channel.accountId, videoId: publishResult.platformVideoId,
              topic: job.topic, llmProvider, ttsProvider: voiceResult.provider,
              uniquenessScore, durationSeconds: assembly.durationSeconds
            },
            timestamp: new Date()
          });
        }

      } catch (channelErr) {
        totalFailed++;
        log.error(`Channel ${channel.accountId} failed: ${channelErr.message}`);
        log.error(channelErr.stack);

        if (!isDryRun) {
          await SystemLog.create({
            runId, event: 'channel_error', module: 'orchestrator',
            level: 'error',
            payload: { accountId: channel.accountId, error: channelErr.message },
            timestamp: new Date()
          });
        }
      }
    }

    log.info(`\nPipeline run ${runId} complete: ${totalPublished} published, ${totalFailed} failed`);

    if (!isDryRun) {
      await SystemLog.create({
        runId, event: 'pipeline_complete', module: 'orchestrator',
        level: 'info',
        payload: { totalPublished, totalFailed, endTime: new Date() },
        timestamp: new Date()
      });
    }

  } catch (fatalErr) {
    log.error(`FATAL ERROR: ${fatalErr.message}`);
    log.error(fatalErr.stack);

    if (!isDryRun) {
      try {
        await SystemLog.create({
          runId, event: 'pipeline_fatal', module: 'orchestrator',
          level: 'error', payload: { error: fatalErr.message },
          timestamp: new Date()
        });
      } catch {}
    }

    process.exit(1);

  } finally {
    // ALWAYS clean up temp files
    tmpManager.destroy();
    await disconnectMongoDB();
    log.info(`Pipeline run ${runId} finished — temp files cleaned`);
  }
}

main();
