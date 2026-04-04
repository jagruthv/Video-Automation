'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const log = getModuleLogger('visual-engine');
const VISUAL_TIMEOUT_MS = 90000;
const VISUALS_OUTPUT_DIR = '/tmp/build/visuals';
const I2V_POLL_INTERVAL_MS = 5000;
const I2V_MAX_WAIT_MS = 300000; // 5 minute max per clip

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// UTILITY: Download a file from a URL
// ============================================================
async function downloadFile(url, outputPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(VISUAL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

// ============================================================
// UTILITY: Download a file via native HTTPS pipe (for HF binary blobs)
// ============================================================
function downloadBinary(url, outputPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = fs.createWriteStream(outputPath);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

// ============================================================
// STEP 1 — IMAGE PHASE: Pollinations.ai
// Generates a hyper-consistent base image using locked Anchor + Seed.
// ============================================================
async function generateBaseImage(imagePrompt, globalAnchor, globalSeed, outputPath) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt + ', ' + globalAnchor)}?width=1080&height=1920&seed=${globalSeed}&nologo=true`;
  log.info(`  [IMG] Pollinations → "${imagePrompt.substring(0, 60)}..."`);
  await withRetry(() => downloadFile(url, outputPath), { maxRetries: 2, name: 'pollinations-img' });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 10000) {
    throw new Error('Pollinations: Image too small or missing');
  }
}

// ============================================================
// STEP 2a — VIDEO PHASE (Priority 1): Hugging Face Inference API
// Uses HF_TOKEN from .env. Model: Lightricks/LTX-Video (I2V)
// ============================================================
async function animateWithHFToken(imagePath, motionPrompt, outputPath) {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) throw new Error('HF_TOKEN not set');

  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');
  const mimeType = 'image/jpeg';

  log.info(`  [I2V] HF Inference API → "${motionPrompt}"`);

  const body = JSON.stringify({
    inputs: {
      image: `data:${mimeType};base64,${imageBase64}`,
      prompt: motionPrompt,
      negative_prompt: 'blurry, low quality, watermark, text overlay',
      num_frames: 49,
      fps: 24,
      guidance_scale: 3.0,
    }
  });

  const res = await fetch('https://api-inference.huggingface.co/models/Lightricks/LTX-Video', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hfToken}`,
      'Content-Type': 'application/json',
      'X-Wait-For-Model': 'true',
    },
    body,
    signal: AbortSignal.timeout(I2V_MAX_WAIT_MS),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HF Inference API error ${res.status}: ${errText.substring(0, 200)}`);
  }

  const videoBuffer = Buffer.from(await res.arrayBuffer());
  if (videoBuffer.length < 50000) throw new Error(`HF returned suspiciously small video: ${videoBuffer.length} bytes`);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, videoBuffer);
  log.info(`  [I2V] ✅ HF Inference API succeeded (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

// ============================================================
// STEP 2b — VIDEO PHASE (Priority 2): Gradio Public Space
// Free, no key needed. Hits public Lightricks/LTX-Video Space.
// ============================================================
async function animateWithGradioSpace(imagePath, motionPrompt, outputPath) {
  log.info(`  [I2V] Gradio Space fallback → "${motionPrompt}"`);

  // Lazy-load Gradio client to avoid startup crash if not installed
  const { Client, handle_file } = require('@gradio/client');
  const app = await Client.connect('Lightricks/LTX-Video', { hf_token: process.env.HF_TOKEN });

  const result = await app.predict('/generate_video_from_image', {
    image: handle_file(imagePath),
    prompt: motionPrompt,
    negative_prompt: 'blurry, low quality, watermark, worst quality',
    num_frames: 49,
    frame_rate: 24,
    guidance_scale: 3.0,
    seed: Math.floor(Math.random() * 999999),
    num_inference_steps: 30,
  });

  // Gradio returns a blob URL — download the mp4 directly
  const videoUrl = result?.data?.[0]?.url || result?.data?.[0];
  if (!videoUrl) throw new Error('Gradio returned no video URL');
  
  await downloadBinary(videoUrl, outputPath);
  const stat = fs.statSync(outputPath);
  if (stat.size < 50000) throw new Error(`Gradio video too small: ${stat.size} bytes`);
  log.info(`  [I2V] ✅ Gradio Space succeeded (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

// ============================================================
// HYBRID I2V ORCHESTRATOR
// Priority 1: HF_TOKEN Inference API
// Priority 2: Free Gradio Space
// ============================================================
async function animateImage(imagePath, motionPrompt, outputPath) {
  // Try HF Token first
  try {
    await animateWithHFToken(imagePath, motionPrompt, outputPath);
    return;
  } catch (e) {
    log.warn(`  [I2V] HF Token failed: ${e.message} — trying Gradio Space...`);
  }

  // Fall back to Gradio
  await animateWithGradioSpace(imagePath, motionPrompt, outputPath);
}

// ============================================================
// MAIN: ACQUIRE ALL VISUALS
// For each scene: Generate Consistent Image → Animate to Video
// ============================================================
async function acquireVisuals(scriptJson, targetDurationMs, outputDir = VISUALS_OUTPUT_DIR) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const visualsArray = Array.isArray(scriptJson.visuals) ? scriptJson.visuals : [];
  const globalAnchor = scriptJson.global_style_anchor || 'hyper-realistic cinematic lighting, highly detailed';
  const globalSeed   = scriptJson.global_seed || Math.floor(Math.random() * 999999);

  if (visualsArray.length === 0) throw new Error('VISUAL_ACQUISITION_FAILED: No visual prompts in script');

  log.info(`🎨 Processing ${visualsArray.length} scenes [Pollinations → I2V]`);
  log.info(`🔒 Anchor: "${globalAnchor}" | Seed: ${globalSeed}`);

  const clips = [];

  for (let i = 0; i < visualsArray.length; i++) {
    const scene = visualsArray[i];

    // Support both old string format and new object format
    const imagePrompt  = typeof scene === 'string' ? scene : scene.image_prompt;
    const motionPrompt = typeof scene === 'string'
      ? 'Cinematic slow zoom in, subtle atmospheric movement'
      : (scene.motion_prompt || 'Cinematic slow zoom in');

    const imgPath   = path.join(outputDir, `scene_${i}.jpg`);
    const videoPath = path.join(outputDir, `scene_${i}.mp4`);

    log.info(`\n🎬 Scene ${i + 1}/${visualsArray.length}`);

    try {
      // STEP 1: Generate base image (locked seed = visual continuity)
      await generateBaseImage(imagePrompt, globalAnchor, globalSeed, imgPath);

      // STEP 2: Animate it to video
      await animateImage(imgPath, motionPrompt, videoPath);

      // Clean up the source jpg to save disk space
      try { fs.unlinkSync(imgPath); } catch {}

      clips.push({ path: videoPath, type: 'video', provider: 'Pollinations+I2V', attribution: 'Video by Pollinations + HF', durationMs: 0 });

    } catch (err) {
      log.error(`Scene ${i + 1} failed: ${err.message}. Falling back to static image...`);

      // Safe static image fallback — if I2V fails entirely, use the .jpg with zoompan
      if (fs.existsSync(imgPath)) {
        clips.push({ path: imgPath, type: 'image', provider: 'Pollinations Static', attribution: 'Image by Pollinations.ai', durationMs: 0 });
      }
    }
  }

  if (clips.length === 0) throw new Error('VISUAL_ACQUISITION_FAILED: Zero scenes acquired');

  const durationPerClip = Math.round(targetDurationMs / clips.length);
  clips.forEach(c => { c.durationMs = durationPerClip; });

  const videoCount = clips.filter(c => c.type === 'video').length;
  const staticCount = clips.filter(c => c.type === 'image').length;
  log.info(`\n✅ Visual phase complete: ${videoCount} animated clips, ${staticCount} static fallbacks`);

  return { clips, provider: 'hybrid-i2v', attributions: [...new Set(clips.map(c => c.attribution))] };
}

// ============================================================
// HERO THUMBNAIL
// ============================================================
async function generateHeroThumbnail(topic, outputPath) {
  const prompt = `Wide-angle establishing shot, 35mm lens. High-contrast vibrant colors, minimal background, dramatic lighting, centered subject ${topic}`;
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
