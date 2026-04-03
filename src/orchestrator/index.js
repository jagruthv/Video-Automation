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
    const topic = process.argv[2] || "The future of quantum computing";
    log.info(`🚀 Starting AURA V2 Pipeline for topic: "${topic}"`);

    // 1. Get JSON Script Package
    const metadata = await generateScript(topic);

    // 2. Run Voice and Visuals in Parallel
    log.info('Running audio and visual generation in parallel...');
    const audioTask = generateVoice(metadata.script, { 
      outputPath: tmpManager.subpath('audio', 'voice.mp3') 
    });
    
    // acquireVisuals in V2 takes an array of prompts
    const visualTask = acquireVisuals(metadata.visuals, tmpManager.subpath('clips', ''));

    const [voiceResult, visualsResult] = await Promise.all([audioTask, visualTask]);
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
    tmpManager.cleanup();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { main };
