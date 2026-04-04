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
// HISTORICAL MODE: Wikimedia Commons Real Image Fetcher
// ============================================================
async function fetchWikimediaImage(query, outputPath) {
  log.info(`  [WIKI] Fetching real historical photo for: "${query}"`);
  
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&prop=imageinfo&iiprop=url&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.query?.pages) {
        const pages = Object.values(data.query.pages);
        const validPage = pages.find(p => {
          const u = p?.imageinfo?.[0]?.url?.toLowerCase();
          return u && (u.endsWith('.jpg') || u.endsWith('.jpeg') || u.endsWith('.png'));
        });
        
        if (validPage) {
          const imageUrl = validPage.imageinfo[0].url;
          await downloadFile(imageUrl, outputPath);
          if (fs.statSync(outputPath).size >= 5000) {
            log.info(`  [WIKI] ✅ Wikimedia succeeded`);
            return;
          }
        }
      }
    }
  } catch (err) {
    log.warn(`  [WIKI] Wikimedia API error: ${err.message}`);
  }

  log.warn(`  [WIKI] Wikimedia failed, falling back to Pixabay for historical figure...`);
  // Try to use just the main subject name for broader search
  const cleanQuery = query.split('19')[0].split('18')[0].trim(); 
  
  // Directly call the existing fetchPixabayImage
  try {
    await fetchPixabayImage(cleanQuery, outputPath);
    log.info(`  [WIKI] ✅ Pixabay Fallback succeeded`);
  } catch (pixErr) {
    log.warn(`  [WIKI] Pixabay Fallback failed: ${pixErr.message}. Generating historical style AI image via HF...`);
    const aiPrompt = `authentic rare black and white historical photograph of ${cleanQuery}, archival footage, noisy, realistic, 1890s style`;
    try {
      if (!process.env.HF_TOKEN) throw new Error('No HF_TOKEN');
      const body = JSON.stringify({ inputs: aiPrompt, parameters: { width: 768, height: 1344 } });
      const hfRes = await fetch('https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.HF_TOKEN}`, 'Content-Type': 'application/json', 'X-Wait-For-Model': 'true' },
        body
      });
      if (!hfRes.ok) throw new Error(`HF SDXL ${hfRes.status}`);
      const hfBuffer = Buffer.from(await hfRes.arrayBuffer());
      fs.writeFileSync(outputPath, hfBuffer);
      log.info(`  [WIKI] ✅ HF AI Fallback succeeded`);
    } catch (hfErr) {
      throw new Error(`All historical fallbacks failed: ${hfErr.message}`);
    }
  }
}

// ============================================================
// PIXABAY IMAGE — Fallback 
// ============================================================
async function fetchPixabayImage(query, outputPath) {
  if (!process.env.PIXABAY_API_KEY) throw new Error('PIXABAY_API_KEY not set');
  const res = await fetch(
    `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=vertical&per_page=5`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`Pixabay HTTP ${res.status}`);
  const data = await res.json();
  if (!data.hits || data.hits.length === 0) throw new Error('No Pixabay images found');
  const hit = data.hits[Math.floor(Math.random() * Math.min(data.hits.length, 3))];
  await downloadFile(hit.largeImageURL, outputPath);
}

// ============================================================
// VEO 3.1 — Multi-Key Cookie Rotation (4 keys)
// ============================================================
async function fetchVeoVideo(query, outputPath) {
  const cookieKeys = [
    process.env.GOOGLE_WHISK_COOKIE,
    process.env.GOOGLE_WHISK_COOKIE_2,
    process.env.GOOGLE_WHISK_COOKIE_3,
    process.env.GOOGLE_WHISK_COOKIE_4
  ].filter(Boolean);

  if (cookieKeys.length === 0) throw new Error('No GOOGLE_WHISK_COOKIE keys set, skipping Veo');

  let lastError = null;

  for (let keyIndex = 0; keyIndex < cookieKeys.length; keyIndex++) {
    const cookie = cookieKeys[keyIndex];
    log.info(`  [VEO] Trying key ${keyIndex + 1}/${cookieKeys.length}...`);

    try {
      const { Whisk } = require('@rohitaryal/whisk-api');
      const whisk = new Whisk(cookie);
      const images = await whisk.generateImage(query, 1);
      if (!images || images.length === 0) throw new Error('Veo Phase 1: Image Generation Failed');
      const token = await images[0].account.getToken();

      const initRes = await fetch('https://aisandbox-pa.googleapis.com/v1/whisk:generateVideo', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptImageInput: { prompt: images[0].prompt, rawBytes: images[0].encodedMedia },
          modelNameType: 'VEO_3_1_I2V_12STEP', modelKey: '',
          userInstructions: query,
          loopVideo: false,
          clientContext: { workflowId: images[0].workflowId }
        })
      });

      const videoStatusResults = await initRes.json();
      if (videoStatusResults?.error?.code === 429 || (videoStatusResults?.error?.message || '').includes('exhausted')) {
        log.warn(`  [VEO] key ${keyIndex + 1} hit quota limit. Rotating to next key...`);
        lastError = new Error(`Key ${keyIndex + 1} quota exhausted`);
        continue;
      }

      if (videoStatusResults?.error) throw new Error(`Veo API error: ${videoStatusResults.error.message}`);
      if (!videoStatusResults?.operation?.operation?.name) throw new Error('Veo API: No operation name returned');

      const id = videoStatusResults.operation.operation.name;
      let polls = 0, finalVideoBytes = null;

      while (polls < 15) {
        polls++;
        const pollRes = await fetch('https://aisandbox-pa.googleapis.com/v1:runVideoFxSingleClipsStatusCheck', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: [{ operation: { name: id } }] })
        });
        const pollData = await pollRes.json();
        if (pollData.status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL') {
          finalVideoBytes = pollData.operations[0].rawBytes;
          break;
        } else if (pollData.status === 'MEDIA_GENERATION_STATUS_ACTIVE') {
          log.info(`  [VEO] Still rendering... (${polls * 15}s / 225s)`);
        }
        await delay(15000);
      }

      if (!finalVideoBytes) throw new Error('Veo logic Timeout after 225 seconds');

      const buffer = Buffer.from(finalVideoBytes.replace(/^data:\w+\/\w+;base64,/, ''), 'base64');
      fs.writeFileSync(outputPath, buffer);
      log.info(`  [VEO] ✅ Veo 3.1 succeeded with key ${keyIndex + 1} (${(buffer.length/1024/1024).toFixed(1)}MB)`);
      return;

    } catch (err) {
      if (!err.message.includes('quota') && !err.message.includes('exhausted')) {
        lastError = err;
        break; // break on non-quota error
      }
      lastError = err;
    }
  }
  throw new Error(`Veo Engine Error: All ${cookieKeys.length} keys failed. Last: ${lastError?.message}`);
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
// Priority 1: Veo 3.1 Text-to-Video
// Priority 2: Hugging Face LTX-Video
// Priority 3: Gradio SVD
// ============================================================
async function animateImage(imagePath, motionPrompt, outputPath, isHistorical = false, veoPrompt = null) {
  // If it's NOT historical (historical requires starting from a fixed Real Image), try Veo 3.1 first
  if (!isHistorical && veoPrompt) {
    try {
      await fetchVeoVideo(veoPrompt, outputPath);
      return 'Google Veo 3.1';
    } catch (e) {
      log.warn(`  [VEO] Failed: ${e.message} — falling back to I2V pipeline...`);
    }
  }

  // Fallback to HF Token (LTX-Video I2V)
  try {
    await animateWithHFToken(imagePath, motionPrompt, outputPath);
    return 'Hugging Face I2V';
  } catch (e) {
    log.warn(`  [I2V] HF Token failed: ${e.message} — trying Gradio Space...`);
  }

  // Fall back to Gradio (SVD I2V)
  await animateWithGradioSpace(imagePath, motionPrompt, outputPath);
  return 'Gradio SVD';
}

// ============================================================
// MAIN: ACQUIRE ALL VISUALS
// For each scene: Generate Consistent Image → Animate to Video
// ============================================================
async function acquireVisuals(scriptJson, targetDurationMs, outputDir = VISUALS_OUTPUT_DIR) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const visualsArray = Array.isArray(scriptJson.visuals) ? scriptJson.visuals : [];
  const globalAnchor = scriptJson.global_style_anchor || 'hyper-realistic cinematic lighting, highly detailed';
  const characterAnchor = scriptJson.character_anchor || '';
  const globalSeed   = scriptJson.global_seed || Math.floor(Math.random() * 999999);
  const isHistorical = scriptJson.is_historical === true;

  if (visualsArray.length === 0) throw new Error('VISUAL_ACQUISITION_FAILED: No visual prompts in script');

  log.info(`🎨 Processing ${visualsArray.length} scenes [Historical: ${isHistorical}]`);
  log.info(`🔒 Char Anchor: "${characterAnchor}" | Style Anchor: "${globalAnchor}" | Seed: ${globalSeed}`);

  // Base Historical Photo cache
  let baseHistoricalImagePath = null;
  if (isHistorical) {
    baseHistoricalImagePath = path.join(outputDir, 'base_historical.jpg');
    const searchQuery = scriptJson.search_queries?.[0] || scriptJson.historical_subject;
    try {
      await fetchWikimediaImage(searchQuery, baseHistoricalImagePath);
    } catch (err) {
      log.warn(`Wikimedia fetch failed: ${err.message}. Falling back to normal flow.`);
    }
  }

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
      let finalProvider = '';

      if (isHistorical && fs.existsSync(baseHistoricalImagePath)) {
        // Historical Flow: Use the exact same real photo for all scenes
        if (i === 0) {
          // Scene 0: Show the raw real picture (Assembly will apply subtle zoom)
          fs.copyFileSync(baseHistoricalImagePath, imgPath);
          clips.push({ path: imgPath, type: 'image', provider: 'Wikimedia Commons', attribution: 'Historical Photo by Wikimedia', durationMs: 0 });
          log.info(`  [SCENE] Included raw real historical picture for intro.`);
          continue;
        } else {
          // Scene 1+: Create videos generated FROM that specific real image
          log.info(`  [SCENE] Generating I2V video from the core historical image...`);
          fs.copyFileSync(baseHistoricalImagePath, imgPath);
          const charPrefix = characterAnchor ? `[${characterAnchor}] ` : '';
          finalProvider = await animateImage(imgPath, `${charPrefix}${motionPrompt}`, videoPath, true);
        }
      } else {
        // Normal Flow: Constant generation (if anchor exists) or diverse generation
        const charPrefix = characterAnchor ? `[${characterAnchor}] ` : '';
        const unifiedImagePrompt = `${charPrefix}${imagePrompt}`;
        const unifiedMotionPrompt = `${charPrefix}${motionPrompt}`;
        const veoPrompt = `${unifiedImagePrompt}. ${unifiedMotionPrompt}. Style: ${globalAnchor}`;
        
        // STEP 1: Generate base AI image (locked seed = visual continuity, fallback for I2V)
        await generateBaseImage(unifiedImagePrompt, globalAnchor, globalSeed, imgPath);

        // STEP 2: Animate it to video (Veo preferred, then SVD)
        finalProvider = await animateImage(imgPath, unifiedMotionPrompt, videoPath, false, veoPrompt);
      }

      // Clean up the unique JPG if a video successfully rendered
      if (fs.existsSync(videoPath) && imgPath !== baseHistoricalImagePath) {
         try { fs.unlinkSync(imgPath); } catch {}
      }

      clips.push({ path: videoPath, type: 'video', provider: finalProvider, attribution: `Video by ${finalProvider}`, durationMs: 0 });

    } catch (err) {
      log.error(`Scene ${i + 1} failed: ${err.message}. Falling back to static image...`);

      // Safe static image fallback — if I2V fails entirely, use the .jpg with zoompan
      if (fs.existsSync(imgPath)) {
        clips.push({ path: imgPath, type: 'image', provider: 'Static Fallback', attribution: 'Image AI Generated', durationMs: 0 });
      } else if (isHistorical && fs.existsSync(baseHistoricalImagePath)) {
        clips.push({ path: baseHistoricalImagePath, type: 'image', provider: 'Wikimedia Commons', attribution: 'Historical Photo', durationMs: 0 });
      }
    }
  }

  if (clips.length === 0) throw new Error('VISUAL_ACQUISITION_FAILED: Zero scenes acquired');

  const durationPerClip = Math.round(targetDurationMs / clips.length);
  clips.forEach(c => { c.durationMs = durationPerClip; });

  const videoCount = clips.filter(c => c.type === 'video').length;
  const staticCount = clips.filter(c => c.type === 'image').length;
  log.info(`\n✅ Visual phase complete: ${videoCount} animated clips, ${staticCount} static fallbacks`);

  return { clips, provider: 'aura-v2', attributions: [...new Set(clips.map(c => c.attribution))] };
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
