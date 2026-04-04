'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const log = getModuleLogger('visual-engine');
const VISUAL_TIMEOUT_MS = 60000;
const VISUALS_OUTPUT_DIR = '/tmp/build/visuals';

async function downloadFile(url, outputPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(VISUAL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

// ============================================================
// MAIN: ACQUIRE ALL VISUALS
// Architectural Upgrade: Enforces absolute visual continuity 
// via Pollinations.ai with Global Style Anchor & Global Seed.
// ============================================================
async function acquireVisuals(scriptJson, targetDurationMs, outputDir = VISUALS_OUTPUT_DIR) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const visualsArray = Array.isArray(scriptJson.visuals) ? scriptJson.visuals : [];
  
  // Extract the strict continuity parameters from the script JSON
  const globalAnchor = scriptJson.global_style_anchor || 'hyper-realistic cinematic lighting, highly detailed';
  const globalSeed = scriptJson.global_seed || Math.floor(Math.random() * 999999);

  if (visualsArray.length === 0) {
    throw new Error('VISUAL_ACQUISITION_FAILED: Script provided no visual prompts.');
  }

  log.info(`🎨 Acquiring ${visualsArray.length} consistent images via Pollinations...`);
  log.info(`🔒 Locked Style Anchor: "${globalAnchor}" | Locked Seed: ${globalSeed}`);
  
  const clips = [];

  for (let i = 0; i < visualsArray.length; i++) {
    const prompt = visualsArray[i];
    const imgPath = path.join(outputDir, `scene_${i}.jpg`);
    
    // ACTION A & B: Native HTTPS fetch using exact template string
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ", " + globalAnchor)}?width=1080&height=1920&seed=${globalSeed}&nologo=true`;

    log.info(`Scene ${i + 1}: Pollinations Fetch → "${prompt}"`);
    
    try {
      await withRetry(() => downloadFile(url, imgPath), { maxRetries: 2, name: `pollinations-${i}` });
      
      // ACTION C: Ensured download and size validation
      if (!fs.existsSync(imgPath) || fs.statSync(imgPath).size < 10000) {
        throw new Error('Downloaded image is corrupted or too small');
      }

      clips.push({ 
        path: imgPath, 
        type: 'image', 
        provider: 'Pollinations.ai', 
        attribution: 'Image by Pollinations.ai', 
        durationMs: 0 
      });
    } catch (err) {
      log.error(`Scene ${i + 1} critically failed — skipping: ${err.message}`);
    }
  }

  if (clips.length === 0) {
    throw new Error('VISUAL_ACQUISITION_FAILED: Zero scenes acquired.');
  }

  const durationPerClip = Math.round(targetDurationMs / clips.length);
  clips.forEach(c => { c.durationMs = durationPerClip; });

  log.info(`✅ Visual phase complete: ${clips.length} perfectly consistent scenes acquired.`);
  
  return { clips, provider: 'pollinations', attributions: ['Image by Pollinations.ai'] };
}

// ============================================================
// HERO THUMBNAIL
// ============================================================
async function generateHeroThumbnail(topic, outputPath) {
  const prompt = `High-contrast, vibrant colors, minimal background, glowing centered tech icon, 9:16, ultra-detailed ${topic}`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&seed=1234&nologo=true`;
  try {
    await withRetry(() => downloadFile(url, outputPath), { maxRetries: 2, name: 'hero-thumbnail' });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) return true;
    throw new Error('Thumbnail too small');
  } catch (err) {
    log.error(`Hero Thumbnail generation failed: ${err.message}`);
    return false;
  }
}

module.exports = { acquireVisuals, generateHeroThumbnail };
