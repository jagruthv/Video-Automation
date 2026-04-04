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
// IMAGE SOURCE PRIORITY 1: Hugging Face Inference API (SDXL)
// Uses HF_TOKEN. Model: stabilityai/stable-diffusion-xl-base-1.0
// Fast, private, and high quality. ~5-10s per image.
// ============================================================
async function generateImageHFInference(imagePrompt, globalAnchor, globalSeed, outputPath) {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) throw new Error('HF_TOKEN not set');

  const fullPrompt = `${imagePrompt}, ${globalAnchor}`;
  log.info(`  [IMG-1] HF SDXL Inference → "${fullPrompt.substring(0, 80)}..."`);

  const body = JSON.stringify({
    inputs: fullPrompt,
    parameters: {
      width: 768,
      height: 1344,
      seed: globalSeed,
      num_inference_steps: 25,
      guidance_scale: 7.5,
      negative_prompt: 'blurry, distorted, low quality, text, watermark, ugly, deformed'
    }
  });

  const res = await fetch('https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hfToken}`,
      'Content-Type': 'application/json',
      'X-Wait-For-Model': 'true',
    },
    body,
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HF SDXL ${res.status}: ${txt.substring(0, 150)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 10000) throw new Error(`HF SDXL image too small: ${buffer.length} bytes`);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  log.info(`  [IMG-1] ✅ HF SDXL succeeded (${(buffer.length / 1024).toFixed(0)}KB)`);
}

// ============================================================
// IMAGE SOURCE PRIORITY 2: Hugging Face Gradio Space (FLUX)
// 100% free, no key needed. Hits black-forest-labs/FLUX.1-schnell.
// ============================================================
async function generateImageGradioFlux(imagePrompt, globalAnchor, globalSeed, outputPath) {
  log.info(`  [IMG-2] Gradio FLUX → "${imagePrompt.substring(0, 60)}..."`);

  const { Client } = require('@gradio/client');
  const fullPrompt = `${imagePrompt}, ${globalAnchor}, masterpiece, ultra-detailed, 9:16 vertical`;

  const app = await Client.connect('black-forest-labs/FLUX.1-schnell', {
    hf_token: process.env.HF_TOKEN // optional — speeds up queue if provided
  });

  const result = await app.predict('/infer', {
    prompt: fullPrompt,
    seed: globalSeed,
    randomize_seed: false,
    width: 768,
    height: 1344,
    num_inference_steps: 4,
  });

  const imageUrl = result?.data?.[0]?.url || result?.data?.[0];
  if (!imageUrl) throw new Error(`FLUX Gradio returned no image URL`);

  await downloadBinaryToFile(imageUrl, outputPath);
  const size = fs.statSync(outputPath).size;
  if (size < 10000) throw new Error(`FLUX image too small: ${size} bytes`);
  log.info(`  [IMG-2] ✅ Gradio FLUX succeeded (${(size / 1024).toFixed(0)}KB)`);
}

// ============================================================
// IMAGE SOURCE PRIORITY 3: Pollinations.ai (fallback)
// Free, no key. Sometimes down.
// ============================================================
async function generateImagePollinations(imagePrompt, globalAnchor, globalSeed, outputPath) {
  const fullPrompt = `${imagePrompt}, ${globalAnchor}`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1080&height=1920&seed=${globalSeed}&nologo=true`;
  log.info(`  [IMG-3] Pollinations fallback → "${imagePrompt.substring(0, 60)}..."`);
  await downloadBinaryToFile(url, outputPath);
  const size = fs.statSync(outputPath).size;
  if (size < 10000) throw new Error(`Pollinations image too small (or 500 error): ${size} bytes`);
  log.info(`  [IMG-3] ✅ Pollinations succeeded (${(size / 1024).toFixed(0)}KB)`);
}

// Helper: download binary via native https with redirect following
function downloadBinaryToFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = fs.createWriteStream(outputPath);
    https.get(url, { timeout: 90000 }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.destroy();
        fs.unlink(outputPath, () => {});
        return downloadBinaryToFile(res.headers.location, outputPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url.substring(0, 80)}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject).on('timeout', () => reject(new Error('Download timed out')));
  });
}

// ============================================================
// HYBRID IMAGE GENERATOR (Cascade)
// ============================================================
async function generateBaseImage(imagePrompt, globalAnchor, globalSeed, outputPath) {
  // Priority 1: HF Inference API (SDXL) — fast, uses HF_TOKEN
  try {
    await generateImageHFInference(imagePrompt, globalAnchor, globalSeed, outputPath);
    return;
  } catch (e) {
    log.warn(`  [IMG] HF Inference failed: ${e.message} → trying FLUX Gradio...`);
  }

  // Priority 2: Free Gradio FLUX Space — no key needed
  try {
    await generateImageGradioFlux(imagePrompt, globalAnchor, globalSeed, outputPath);
    return;
  } catch (e) {
    log.warn(`  [IMG] Gradio FLUX failed: ${e.message} → trying Pollinations...`);
  }

  // Priority 3: Pollinations.ai
  await generateImagePollinations(imagePrompt, globalAnchor, globalSeed, outputPath);
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

  const res = await fetch('https://router.huggingface.co/hf-inference/models/Lightricks/LTX-Video', {
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
  log.info(`  [I2V] Gradio SVD fallback → "${motionPrompt}"`);

  const { Client, handle_file } = require('@gradio/client');
  // Uses Stable Video Diffusion (SVD XT) — correct /video endpoint confirmed working
  const app = await Client.connect('multimodalart/stable-video-diffusion', {
    hf_token: process.env.HF_TOKEN // using token speeds up queue, but not required
  });

  const result = await app.predict('/video', {
    image: handle_file(imagePath),
    seed: Math.floor(Math.random() * 999999),
    randomize_seed: false,
    motion_bucket_id: 127,   // 1-255: higher = more motion
    fps_id: 8,               // output FPS
  });

  const videoUrl = result?.data?.[0]?.url || result?.data?.[0];
  if (!videoUrl) throw new Error('SVD Gradio returned no video URL');

  await downloadBinaryToFile(videoUrl, outputPath);
  const stat = fs.statSync(outputPath);
  if (stat.size < 50000) throw new Error(`SVD video too small: ${stat.size} bytes`);
  log.info(`  [I2V] ✅ Gradio SVD succeeded (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
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
