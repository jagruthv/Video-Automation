'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const log = getModuleLogger('visual-engine');

const VISUAL_TIMEOUT_MS = 60000;
const POLLINATIONS_COOLDOWN_MS = 5000;
const VISUALS_OUTPUT_DIR = '/tmp/build/visuals';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function downloadFile(url, outputPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(VISUAL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

// ============================================================
// VEO 3.1 — Multi-Key Cookie Rotation (4 keys)
// Automatically rotates to next key on 429 quota errors.
// Set env vars: GOOGLE_WHISK_COOKIE, GOOGLE_WHISK_COOKIE_2,
//               GOOGLE_WHISK_COOKIE_3, GOOGLE_WHISK_COOKIE_4
// ============================================================
async function fetchVeoVideo(query, outputPath) {
  const cookieKeys = [
    process.env.GOOGLE_WHISK_COOKIE,
    process.env.GOOGLE_WHISK_COOKIE_2,
    process.env.GOOGLE_WHISK_COOKIE_3,
    process.env.GOOGLE_WHISK_COOKIE_4
  ].filter(Boolean); // Only use keys that are actually set

  if (cookieKeys.length === 0) throw new Error('No GOOGLE_WHISK_COOKIE keys set, skipping Veo');

  let lastError = null;

  for (let keyIndex = 0; keyIndex < cookieKeys.length; keyIndex++) {
    const cookie = cookieKeys[keyIndex];
    log.info(`Veo: Trying key ${keyIndex + 1}/${cookieKeys.length}...`);

    try {
      const { Whisk } = require('@rohitaryal/whisk-api');
      const whisk = new Whisk(cookie);
      const VEO_MODELS = 'VEO_3_1_I2V_12STEP';

      const images = await whisk.generateImage(query, 1);
      if (!images || images.length === 0) throw new Error('Veo Phase 1: Image Generation Failed');

      const token = await images[0].account.getToken();

      const initRes = await fetch('https://aisandbox-pa.googleapis.com/v1/whisk:generateVideo', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptImageInput: { prompt: images[0].prompt, rawBytes: images[0].encodedMedia },
          modelNameType: VEO_MODELS, modelKey: '',
          userInstructions: query,
          loopVideo: false,
          clientContext: { workflowId: images[0].workflowId }
        })
      });

      const videoStatusResults = await initRes.json();

      // 429 quota hit — rotate to next key immediately
      if (videoStatusResults?.error?.code === 429 ||
          (videoStatusResults?.error?.message || '').includes('exhausted')) {
        log.warn(`Veo key ${keyIndex + 1} hit quota limit. Rotating to next key...`);
        lastError = new Error(`Key ${keyIndex + 1} quota exhausted`);
        continue;
      }

      // Safety filter hit — swap to safe abstract prompt (don't rotate key)
      if (videoStatusResults?.error?.code === 400 ||
          (videoStatusResults?.error?.message || '').includes('PROMINENT_PEOPLE_FILTER_FAILED')) {
        log.warn(`⚠️ Veo safety filter triggered. Switching to abstract fallback.`);
        return await fetchVeoVideoWithCookie(cookie, 'Abstract digital data visualization flowing particles nebula. 4k, hyper-realistic, slow pan right', outputPath);
      }

      if (videoStatusResults?.error) {
        throw new Error(`Veo API error: ${videoStatusResults.error.message}`);
      }

      if (!videoStatusResults?.operation?.operation?.name) {
        throw new Error('Veo API: Failed to initiate video job — no operation name returned');
      }

      const id = videoStatusResults.operation.operation.name;
      let polls = 0;
      let finalVideoBytes = null;

      // 180s patient polling loop (12 polls x 15s)
      while (polls < 12) {
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
          log.info(`Veo: Still rendering... (${polls * 15}s / 180s)`);
        } else {
          log.warn(`Veo: Unrecognized status: ${pollData.status}`);
        }
        await delay(15000);
      }

      if (!finalVideoBytes) throw new Error('Veo Engine Error: Timed out after 180 seconds');

      const buffer = Buffer.from(finalVideoBytes.replace(/^data:\w+\/\w+;base64,/, ''), 'base64');
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, buffer);

      log.info(`✅ Veo 3.1 succeeded with key ${keyIndex + 1}`);
      return 'Google Veo 3.1';

    } catch (err) {
      // Re-throw non-quota errors immediately (don't waste remaining keys)
      if (!err.message.includes('quota') && !err.message.includes('exhausted') && !err.message.includes('RESOURCE_EXHAUSTED')) {
        lastError = err;
        break;
      }
      lastError = err;
    }
  }

  throw new Error(`Veo Engine Error: All ${cookieKeys.length} keys failed. Last: ${lastError?.message}`);
}

// Internal helper: run a Veo generation with a specific cookie (used for safety fallback)
async function fetchVeoVideoWithCookie(cookie, query, outputPath) {
  const { Whisk } = require('@rohitaryal/whisk-api');
  const whisk = new Whisk(cookie);
  const images = await whisk.generateImage(query, 1);
  if (!images || images.length === 0) throw new Error('Veo abstract fallback: Image generation failed');
  const token = await images[0].account.getToken();
  const initRes = await fetch('https://aisandbox-pa.googleapis.com/v1/whisk:generateVideo', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      promptImageInput: { prompt: images[0].prompt, rawBytes: images[0].encodedMedia },
      modelNameType: 'VEO_3_1_I2V_12STEP', modelKey: '',
      userInstructions: query, loopVideo: false,
      clientContext: { workflowId: images[0].workflowId }
    })
  });
  const body = await initRes.json();
  if (!body?.operation?.operation?.name) throw new Error('Veo abstract fallback: No operation returned');
  const id = body.operation.operation.name;
  let polls = 0;
  let finalVideoBytes = null;
  while (polls < 12) {
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
    }
    await delay(15000);
  }
  if (!finalVideoBytes) throw new Error('Veo abstract fallback: Timed out');
  const buffer = Buffer.from(finalVideoBytes.replace(/^data:\w+\/\w+;base64,/, ''), 'base64');
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return 'Google Veo 3.1';
}

function extractKeywords(prompt) {
  let cleaned = (prompt || '').replace(/^(A|An|The)\s+/i, '');
  cleaned = cleaned.split(',')[0].trim();
  const words = cleaned.split(' ').filter(w => w.length > 2);
  return words.slice(0, 3).join(' ');
}

// ============================================================
// PEXELS VIDEO — Fallback 1
// ============================================================
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

// ============================================================
// POLLINATIONS AI — Fallback 2 (Image)
// ============================================================
async function fetchPollinationsImage(prompt, outputPath) {
  await delay(POLLINATIONS_COOLDOWN_MS);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;
  await downloadFile(url, outputPath);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size < 10000) throw new Error('Pollinations image too small');
  return 'Pollinations.ai';
}

// ============================================================
// PEXELS IMAGE — Fallback 3
// ============================================================
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

// ============================================================
// PIXABAY IMAGE — Fallback 4
// ============================================================
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

// ============================================================
// IMAGE / VIDEO ACQUISITION CASCADE
// New Priority: 1. Pollinations, 2. Veo, 3. Pexels, 4. Pixabay
// ============================================================
async function acquireVideo(query, videoPath, imageFallbackPath, sceneIndex) {
  const keywords = extractKeywords(query);

  // 1: Pollinations AI (Image)
  try {
    log.info(`Scene ${sceneIndex}: Pollinations AI (Priority 1) → "${query.substring(0, 60)}..."`);
    const provider = await withRetry(() => fetchPollinationsImage(query, imageFallbackPath), { maxRetries: 2, name: `pollinations-${sceneIndex}` });
    return { path: imageFallbackPath, type: 'image', provider, attribution: 'Image by Pollinations.ai' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Pollinations failed (${err.message}). Falling back to Google Veo 3.1...`);
  }

  // 2: Google Veo 3.1 (Video)
  try {
    log.info(`Scene ${sceneIndex}: Google Veo 3.1 → "${query}"`);
    const provider = await withRetry(async () => {
      try {
        return await fetchVeoVideo(query, videoPath);
      } catch (veoErr) {
        if (veoErr.message && (veoErr.message.includes('PROMINENT_PEOPLE_FILTER_FAILED') || veoErr.message.includes('INVALID_ARGUMENT'))) {
          log.warn(`⚠️ Veo safety filter triggered. Switching to abstract fallback.`);
          return await fetchVeoVideo('Abstract digital data visualization flowing particles nebula. 4k, hyper-realistic, slow pan right', videoPath);
        }
        throw veoErr;
      }
    }, { maxRetries: 1, name: `veo-video-${sceneIndex}` });
    return { path: videoPath, type: 'video', provider, attribution: 'Video by Google Veo' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Veo failed (${err.message}). Falling back to Pexels Video...`);
  }

  // 3: Pexels Video
  try {
    log.info(`Scene ${sceneIndex}: Pexels Video → "${query}"`);
    const provider = await withRetry(() => fetchPexelsVideo(query, videoPath), { maxRetries: 2, name: `pexels-video-${sceneIndex}` });
    return { path: videoPath, type: 'video', provider, attribution: 'Video by Pexels' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Pexels Video failed. Falling back to Pexels Image...`);
  }

  // 4: Pexels Image
  try {
    log.info(`Scene ${sceneIndex}: Pexels Image → "${keywords}"`);
    const provider = await fetchPexelsImage(keywords, imageFallbackPath);
    return { path: imageFallbackPath, type: 'image', provider, attribution: 'Photo by Pexels' };
  } catch {
    log.warn(`Scene ${sceneIndex}: Pexels Image failed. Trying Pixabay...`);
  }

  // 5: Pixabay Image
  try {
    log.info(`Scene ${sceneIndex}: Pixabay Image → "${keywords}"`);
    const provider = await fetchPixabayImage(keywords, imageFallbackPath);
    return { path: imageFallbackPath, type: 'image', provider, attribution: 'Image by Pixabay' };
  } catch {
    log.error(`Scene ${sceneIndex}: All providers failed. Deploying Unsplash placeholder.`);
    const fallbackUrl = 'https://source.unsplash.com/1080x1920/?technology,abstract';
    await downloadFile(fallbackUrl, imageFallbackPath);
    return { path: imageFallbackPath, type: 'image', provider: 'Unsplash Static Placeholder', attribution: 'Image by Unsplash' };
  }
}

// ============================================================
// MAIN: ACQUIRE ALL VISUALS
// Iterates the exact array from script-writer. Saves to /tmp/build/visuals/
// ============================================================
async function acquireVisuals(scriptJson, targetDurationMs, outputDir = VISUALS_OUTPUT_DIR) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const visualsArray = Array.isArray(scriptJson.visuals)
    ? scriptJson.visuals
    : (scriptJson.visuals?.clips || []);

  if (visualsArray.length === 0) {
    visualsArray.push(
      'Abstract quantum particles colliding in deep space. 4k, hyper-realistic, slow pan right',
      'Macro shot of glowing circuit board traces. 4k, hyper-realistic, slow pan right',
      'Deep ocean bioluminescent organisms floating. 4k, hyper-realistic, slow pan right',
      'Timelapse of storm clouds forming over a mountain range. 4k, hyper-realistic, slow pan right',
      'Abstract digital data streams flowing through neon tunnels. 4k, hyper-realistic, slow pan right'
    );
  }

  log.info(`Acquiring ${visualsArray.length} Veo 3.1 scenes...`);
  const clips = [];

  for (let i = 0; i < visualsArray.length; i++) {
    const item = visualsArray[i];
    const query = typeof item === 'string' ? item : (item.query || item.prompt || 'abstract technology');
    const effect = 'pan_right'; // Unified effect to match "slow pan right" Veo directive

    try {
      const videoPath = path.join(outputDir, `scene_${i}.mp4`);
      const imgPath = path.join(outputDir, `scene_${i}.jpg`);
      const result = await acquireVideo(query, videoPath, imgPath, i + 1);
      clips.push({ ...result, effect, durationMs: 0 });
    } catch (err) {
      log.error(`Scene ${i + 1} critically failed — skipping: ${err.message}`);
    }
  }

  if (clips.length === 0) {
    throw new Error('VISUAL_ACQUISITION_FAILED: Zero scenes acquired. Even placeholders failed.');
  }

  const durationPerClip = Math.round(targetDurationMs / clips.length);
  clips.forEach(c => { c.durationMs = durationPerClip; });

  log.info(`Visuals complete: ${clips.length} scenes. ~${Math.round(durationPerClip / 1000)}s each.`);

  const attributions = [...new Set(clips.map(c => c.attribution))];
  return { clips, provider: 'hybrid', attributions };
}

// ============================================================
// HERO THUMBNAIL
// ============================================================
async function generateHeroThumbnail(topic, outputPath) {
  const prompt = `High-contrast, vibrant colors, minimal background, glowing centered tech icon, 9:16, ultra-detailed ${topic}`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;
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
