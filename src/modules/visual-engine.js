'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const log = getModuleLogger('visual-engine');

const VISUAL_TIMEOUT_MS = 60000; // 60s — Pollinations AI generation needs patience

/**
 * Download a file from URL to local path.
 * Uses a 60s timeout to allow AI image generation to complete.
 */
async function downloadFile(url, outputPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(VISUAL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

/**
 * Fetch an AI-generated video via Google Veo 3.1 (Whisk API)
 * Timeout managed internally by API or by manual retry limits.
 */
async function fetchVeoVideo(query, outputPath) {
  if (!process.env.GOOGLE_WHISK_COOKIE) throw new Error('GOOGLE_WHISK_COOKIE not set, skipping Veo');
  
  try {
    const { Whisk } = require('@rohitaryal/whisk-api');
    const whisk = new Whisk(process.env.GOOGLE_WHISK_COOKIE);
    const VEO_MODELS = "VEO_3_1_I2V_12STEP";
    
    // Phase 1: Base Image
    const images = await whisk.generateImage(query, 1);
    if (!images || images.length === 0) throw new Error("Veo Phase 1: Image Generation Failed");
    
    // Phase 2: Animate (Appended with the Director Prompt suffix for high-engagement visuals)
    const animScript = `${query}, Cinematic, 4k, macro photography, dramatic side-lighting, moving particles, and high-motion dynamics.`;
    const video = await images[0].animate(animScript, VEO_MODELS);
    
    // Phase 3: Transfer to pipeline location
    const tempDir = path.dirname(outputPath);
    const tempPath = video.save(tempDir);
    fs.copyFileSync(tempPath, outputPath);
    fs.unlinkSync(tempPath);
    
    return 'Google Veo 3.1';
  } catch (error) {
    throw new Error(`Veo Engine Error: ${error.message}`);
  }
}

/**
 * Smart Keyword Extraction for Stock APIs — strips filler words, takes first 3 meaningful terms.
 */
function extractKeywords(prompt) {
  let cleaned = (prompt || '').replace(/^(A|An|The)\s+/i, '');
  cleaned = cleaned.split(',')[0].trim();
  const words = cleaned.split(' ').filter(w => w.length > 2);
  return words.slice(0, 3).join(' ');
}

/**
 * Fetch a Pexels Video (portrait orientation, HD quality).
 * Timeout: 60s.
 */
async function fetchPexelsVideo(query, outputPath) {
  if (!process.env.PEXELS_API_KEY) throw new Error('PEXELS_API_KEY not set');
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=large&per_page=5`,
    {
      headers: { 'Authorization': process.env.PEXELS_API_KEY },
      signal: AbortSignal.timeout(VISUAL_TIMEOUT_MS)
    }
  );
  if (!res.ok) throw new Error(`Pexels Video HTTP ${res.status}`);
  const data = await res.json();
  if (!data.videos || data.videos.length === 0) throw new Error('No Pexels videos found');
  const video = data.videos[Math.floor(Math.random() * data.videos.length)];
  const file = video.video_files.find(f => f.quality === 'hd') || video.video_files[0];
  await downloadFile(file.link, outputPath);
  return 'Pexels Video';
}

/**
 * Fetch an AI-generated image from Pollinations.ai.
 * Timeout: 60s — give the AI time to render.
 */
async function fetchPollinationsImage(prompt, outputPath) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;
  await downloadFile(url, outputPath);
  if (fs.statSync(outputPath).size < 10000) throw new Error('Pollinations returned an image that is too small (likely placeholder)');
  return 'Pollinations.ai';
}

/**
 * Fetch a stock image from Pexels Images API.
 * Timeout: 60s.
 */
async function fetchPexelsImage(query, outputPath) {
  if (!process.env.PEXELS_API_KEY) throw new Error('PEXELS_API_KEY not set');
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=5`,
    {
      headers: { 'Authorization': process.env.PEXELS_API_KEY },
      signal: AbortSignal.timeout(VISUAL_TIMEOUT_MS)
    }
  );
  if (!res.ok) throw new Error(`Pexels Image HTTP ${res.status}`);
  const data = await res.json();
  if (!data.photos || data.photos.length === 0) throw new Error('No Pexels photos found');
  const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
  await downloadFile(photo.src.portrait || photo.src.large, outputPath);
  return 'Pexels Image';
}

/**
 * Fetch a stock image from Pixabay API.
 * Timeout: 60s.
 */
async function fetchPixabayImage(query, outputPath) {
  if (!process.env.PIXABAY_API_KEY) throw new Error('PIXABAY_API_KEY not set');
  const res = await fetch(
    `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=vertical&per_page=5`,
    { signal: AbortSignal.timeout(VISUAL_TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`Pixabay HTTP ${res.status}`);
  const data = await res.json();
  if (!data.hits || data.hits.length === 0) throw new Error('No Pixabay images found');
  const hit = data.hits[Math.floor(Math.random() * Math.min(data.hits.length, 3))];
  await downloadFile(hit.largeImageURL, outputPath);
  return 'Pixabay';
}

/**
 * IMAGE FALLBACK CASCADE:
 *   1. Pollinations AI (60s wait — best quality)
 *   2. Pexels Image stock  
 *   3. Pixabay stock
 */
async function acquireImage(prompt, outputPath, sceneIndex) {
  const keywords = extractKeywords(prompt);

  // PRIMARY: Pollinations AI image generation
  try {
    log.info(`Scene ${sceneIndex}: Pollinations AI → "${prompt.substring(0, 50)}..."`);
    const provider = await withRetry(
      () => fetchPollinationsImage(prompt, outputPath),
      { maxRetries: 2, name: `pollinations-${sceneIndex}`, baseDelay: 3000 }
    );
    return { provider, attribution: 'Image by Pollinations.ai' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Pollinations failed (${err.message}). Trying Pexels Image...`);
  }

  // FALLBACK 1: Pexels stock image
  try {
    const provider = await fetchPexelsImage(keywords, outputPath);
    return { provider, attribution: 'Photo by Pexels' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Pexels Image failed (${err.message}). Trying Pixabay...`);
  }

  // FALLBACK 2: Pixabay stock image
  try {
    const provider = await fetchPixabayImage(keywords, outputPath);
    return { provider, attribution: 'Image by Pixabay' };
  } catch (err) {
    log.error(`Scene ${sceneIndex}: All image providers failed. ${err.message}`);
    throw new Error(`All image providers exhausted for scene ${sceneIndex}`);
  }
}

/**
 * VIDEO FALLBACK CASCADE:
 *   1. Google Veo 3.1 (AI Video generation via Whisk)
 *   2. Pexels Video (portrait, HD stock)
 *   3. Pollinations AI image using query as prompt (graceful downgrade)
 */
async function acquireVideo(query, videoPath, imageFallbackPath, sceneIndex) {
  // PRIMARY: Google Veo 3.1 (Whisk)
  try {
    log.info(`Scene ${sceneIndex}: Google Veo 3.1 → "${query}"`);
    // Veo generation is incredibly slow, so 1 retry only, and very patient timeout (3-5 minutes natively).
    const provider = await withRetry(
      () => fetchVeoVideo(query, videoPath),
      { maxRetries: 1, name: `veo-video-${sceneIndex}`, baseDelay: 10000 }
    );
    return { path: videoPath, type: 'video', provider, attribution: 'Video by Google Veo' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Google Veo 3.1 failed (${err.message}). Falling back to Pexels Video...`);
  }

  // FALLBACK 1: Pexels Video
  try {
    log.info(`Scene ${sceneIndex}: Pexels Video → "${query}"`);
    const provider = await withRetry(
      () => fetchPexelsVideo(query, videoPath),
      { maxRetries: 2, name: `pexels-video-${sceneIndex}`, baseDelay: 2000 }
    );
    return { path: videoPath, type: 'video', provider, attribution: 'Video by Pexels' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Pexels Video failed (${err.message}). Falling back to Pollinations image...`);
  }

  // FALLBACK 2: Pollinations AI image using the video query as image prompt
  const { provider, attribution } = await acquireImage(query, imageFallbackPath, sceneIndex);
  return { path: imageFallbackPath, type: 'image', provider, attribution };
}

/**
 * Master visual acquisition — serially fetches each scene with full fallback chains.
 * Returns clip metadata for the assembly engine.
 */
async function acquireVisuals(scriptJson, targetDurationMs, outputDir = '/tmp/build/clips') {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const visualsArray = scriptJson.visuals || [
    { type: 'image', prompt: 'Cyberpunk hacker typing furiously', effect: 'zoom_in' },
    { type: 'video', query: 'matrix code', effect: 'pan_right' },
    { type: 'image', prompt: 'holographic neon sign', effect: 'glitch' }
  ];

  log.info(`Acquiring ${visualsArray.length} hybrid visual scenes...`);
  const clips = [];

  for (let i = 0; i < visualsArray.length; i++) {
    const item = visualsArray[i];
    const effect = item.effect || 'zoom_in';

    try {
      if (item.type === 'video') {
        const videoPath = path.join(outputDir, `scene_${i}.mp4`);
        const imgFallbackPath = path.join(outputDir, `scene_${i}.jpg`);
        const result = await acquireVideo(item.query || item.prompt || 'technology', videoPath, imgFallbackPath, i + 1);
        clips.push({ ...result, effect, durationMs: 0 });
        log.info(`Scene ${i + 1}/${visualsArray.length} acquired: ${result.type} (${result.provider})`);
      } else {
        const imgPath = path.join(outputDir, `scene_${i}.jpg`);
        const prompt = item.prompt || item.query || 'futuristic technology';
        const { provider, attribution } = await acquireImage(prompt, imgPath, i + 1);
        clips.push({ path: imgPath, type: 'image', effect, provider, attribution, durationMs: 0 });
        log.info(`Scene ${i + 1}/${visualsArray.length} acquired: image (${provider})`);
      }
    } catch (err) {
      log.error(`Scene ${i + 1} completely failed — skipping: ${err.message}`);
    }
  }

  if (clips.length < 3) {
    throw new Error(`VISUAL_ACQUISITION_FAILED: Only ${clips.length} scene(s) acquired — need at least 3.`);
  }

  const durationPerClip = Math.round(targetDurationMs / clips.length);
  clips.forEach(c => { c.durationMs = durationPerClip; });

  log.info(`Visuals complete: ${clips.length} scenes, ~${Math.round(targetDurationMs / 1000)}s total divided equally.`);

  const attributions = [...new Set(clips.map(c => c.attribution))];
  return { clips, provider: 'hybrid', attributions };
}

/**
 * Generate a high-impact Hero Image (9:16 vertical) to act as an automated thumbnail.
 * Powered purely by Pollinations (no API key needed, unlimited).
 */
async function generateHeroThumbnail(topic, outputPath) {
  const prompt = `High-contrast, vibrant colors, minimal background, glowing centered tech icon, 9:16, ultra-detailed ${topic}`;
  log.info(`Generating Hero Thumbnail for: "${topic}"...`);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;
  
  try {
    await withRetry(
      () => downloadFile(url, outputPath),
      { maxRetries: 2, name: 'hero-thumbnail', baseDelay: 2000 }
    );
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
      log.info(`✅ Hero Thumbnail generated: ${outputPath}`);
      return true;
    }
    throw new Error('Downloaded thumbnail was a placeholder or corrupted size.');
  } catch (err) {
    log.error(`Hero Thumbnail generation failed: ${err.message}`);
    return false;
  }
}

module.exports = { acquireVisuals, generateHeroThumbnail };
