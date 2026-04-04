'use strict';

require('dotenv').config();

const { getModuleLogger } = require('../utils/logger');
const { generateScript } = require('../modules/script-writer');
const { generateVoice } = require('../modules/voice-engine');
const { acquireVisuals } = require('../modules/visual-engine');
const { assembleVideo } = require('../modules/assembly-engine');
const { uploadToStaging } = require('../modules/supabase-uploader');
const TmpManager = require('../utils/tmp-manager');

const log = getModuleLogger('orchestrator');

async function main() {
  const tmpManager = new TmpManager('/tmp/build');
  
  try {
    log.info(`🚀 Starting AURA V2 Pipeline — Fully Autonomous Mode`);

    let attempt = 0;
    let finalSuccess = false;

    while (attempt < 5) {
      attempt++;
      try {
        tmpManager.create();
        log.info(`\n================================`);
        log.info(`[Pipeline Attempt ${attempt}/5] Initiating Generation Cycle`);
        log.info(`================================\n`);

        const metadata = await generateScript();
        
        const voiceResult = await generateVoice(metadata.script, { 
          outputPath: tmpManager.subpath('audio', 'voice.mp3') 
        });

        // Normalization adds 1s, so 64s audio -> 65s final video.
        if (voiceResult.durationMs > 64000) {
          throw new Error(`QA_FAILED: Script generated audio of ${(voiceResult.durationMs/1000).toFixed(1)}s (exceeds 64s max)`);
        }

        // 3. Run Visuals
        log.info('Running visual generation...');
        const visualsResult = await acquireVisuals(metadata, voiceResult.durationMs, tmpManager.subpath('clips', ''));
        
        // ==========================================
        // QA GATE 1: VISUAL INTEGRITY
        // ==========================================
        const clips = visualsResult.clips || visualsResult;
        const staticCount = clips.filter(c => c.type === 'image' || c.provider === 'Static Fallback').length;
        if (clips.length > 3 && staticCount > Math.floor(clips.length / 2)) {
           throw new Error(`QA_FAILED: Visual Engine produced a slideshow (${staticCount} fallbacks out of ${clips.length} clips). I2V Apis are likely down.`);
        }
        log.info(`✅ QA PASS: Visual Integrity (${staticCount} fallbacks out of ${clips.length})`);

        // 4. FFmpeg Assembly
        log.info('Assembling final video via FFmpeg (with dynamic scene looping enabled)...');
        const assembly = await assembleVideo(
          tmpManager.subpath('audio', 'voice.mp3'),
          clips,
          voiceResult.wordTimestamps,
          { loopVisuals: true }
        );

        // ==========================================
        // QA GATE 2: AUDIO CUTOFF PREVENTION
        // ==========================================
        const fs = require('fs');
        const { execSync } = require('child_process');
        const finalVideoDuration = parseFloat(execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${assembly.videoPath}"`,
          { encoding: 'utf8' }
        ).trim());
        const expectedDuration = voiceResult.durationMs / 1000;
        
        if (finalVideoDuration < expectedDuration - 1.5) {
           throw new Error(`QA_FAILED: FFmpeg output (${finalVideoDuration.toFixed(1)}s) is significantly shorter than audio (${expectedDuration.toFixed(1)}s).`);
        }
        log.info(`✅ QA PASS: Length Integrity (Video: ${finalVideoDuration.toFixed(1)}s | Audio: ${expectedDuration.toFixed(1)}s)`);

        // 5. Staging
        log.info('Video successfully assembled and passed all QA gates.');
        log.info('Sending to Supabase Staging...');
        await uploadToStaging(assembly.videoPath, metadata);

        log.info("🚀 Success! Video is now live in Supabase Staging.");
        finalSuccess = true;
        break; // Break out of the retry loop completely on success!

      } catch (runErr) {
        log.warn(`❌ Run Failed: ${runErr.message}`);
        if (attempt >= 5) {
           throw new Error(`Pipeline exhausted all 5 attempts. Last Error: ${runErr.message}`);
        }
        log.info(`Scrubbing temporary workspace and restarting pipeline...`);
        tmpManager.destroy(); // Wipe the failed slate clean
      }
    }
  } catch (fatalErr) {
    log.error(`🔥 FATAL ORCHESTRATOR ERROR: ${fatalErr.message}`);
  } finally {
    try { tmpManager.destroy(); } catch(e){}
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('Unhandled error in top-level execution:', err);
    process.exit(1);
  });
}

module.exports = { main };
