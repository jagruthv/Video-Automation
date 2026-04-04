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
    tmpManager.create();
    log.info(`🚀 Starting AURA V2 Pipeline — Fully Autonomous Mode`);

    // 1 & 2: Loop until we get a script under 64 seconds
    let metadata, voiceResult;
    let attempt = 0;
    while (attempt < 5) {
      attempt++;
      log.info(`[Attempt ${attempt}/5] Generating Script & Audio...`);
      metadata = await generateScript();
      
      voiceResult = await generateVoice(metadata.script, { 
        outputPath: tmpManager.subpath('audio', 'voice.mp3') 
      });

      // Normalization adds 1s, so 64s audio -> 65s final video.
      if (voiceResult.durationMs > 64000) {
        log.warn(`⚠️ Script generated audio of ${(voiceResult.durationMs/1000).toFixed(1)}s, which is > 64s! Restarting Gemini...`);
        continue;
      }
      break; 
    }

    if (voiceResult.durationMs > 64000) throw new Error('Failed to generate a script under 64s after 5 attempts');

    // 3. Run Visuals (now that we know audio fits)
    log.info('Running visual generation...');
    const visualTask = await acquireVisuals(metadata, voiceResult.durationMs, tmpManager.subpath('clips', ''));
    const visualsResult = visualTask;
    log.info('Audio and visual assets successfully generated.');

    // 3. FFmpeg Assembly
    log.info('Assembling final video via FFmpeg (with dynamic scene looping enabled)...');
    
    // Pass loopVisuals: true so that even if only 1 scene is acquired, it will loop indefinitely until audio ends.
    const assembly = await assembleVideo(
      tmpManager.subpath('audio', 'voice.mp3'),
      visualsResult.clips || visualsResult,
      voiceResult.wordTimestamps,
      { loopVisuals: true }
    );
    log.info(`Video successfully assembled at ${assembly.videoPath}`);

    // 4. Staging
    log.info('Sending to Supabase Staging...');
    await uploadToStaging(assembly.videoPath, metadata);

    log.info("🚀 Success! Video is now live in Supabase Staging.");
    
  } catch (error) {
    log.error(`Pipeline encountered a fatal error: ${error.message}`);
  } finally {
    tmpManager.destroy();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('Unhandled error in top-level execution:', err);
    process.exit(1);
  });
}

module.exports = { main };
