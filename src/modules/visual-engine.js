'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const log = getModuleLogger('visual-engine');

const VISUAL_TIMEOUT_MS = 60000;
const POLLINATIONS_COOLDOWN_MS = 5000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function downloadFile(url, outputPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(VISUAL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

async function fetchVeoVideo(query, outputPath) {
  if (!process.env.GOOGLE_WHISK_COOKIE) throw new Error('GOOGLE_WHISK_COOKIE not set, skipping Veo');
  
  try {
    const { Whisk } = require('@rohitaryal/whisk-api');
    const whisk = new Whisk(process.env.GOOGLE_WHISK_COOKIE);
    const VEO_MODELS = "VEO_3_1_I2V_12STEP";
    
    const images = await whisk.generateImage(query, 1);
    if (!images || images.length === 0) throw new Error("Veo Phase 1: Image Generation Failed");
    
    const animScript = `${query}, Cinematic, 4k, macro photography, dramatic side-lighting, moving particles, and high-motion dynamics.`;
    
    // Bypass whisk-api's native animate() restriction to manually enforce the 180s patient loop
    const token = await images[0].account.getToken();
    
    const initRes = await fetch("https://aisandbox-pa.googleapis.com/v1/whisk:generateVideo", {
       method: 'POST',
       headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
       body: JSON.stringify({
          promptImageInput: { prompt: images[0].prompt, rawBytes: images[0].encodedMedia },
          modelNameType: VEO_MODELS,
          modelKey: "",
          userInstructions: animScript,
          loopVideo: false,
          clientContext: { workflowId: images[0].workflowId }
       })
    });
    
    const videoStatusResults = await initRes.json();
    if (!videoStatusResults?.operation?.operation?.name) throw new Error("Veo API: Failed to initiate video job");
    const id = videoStatusResults.operation.operation.name;

    let polls = 0;
    let finalVideoBytes = null;
    
    // ACTION: Increase polling limit to exactly 180 seconds (12 polls * 15s)
    while (polls < 12) {
       polls++;
       const pollRes = await fetch("https://aisandbox-pa.googleapis.com/v1:runVideoFxSingleClipsStatusCheck", {
          method: 'POST',
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ operations: [{ operation: { name: id } }] })
       });
       
       const pollData = await pollRes.json();
       
       if (pollData.status === "MEDIA_GENERATION_STATUS_SUCCESSFUL") {
          finalVideoBytes = pollData.operations[0].rawBytes;
          break;
       } else if (pollData.status === "MEDIA_GENERATION_STATUS_ACTIVE") {
          log.info(`Veo API: Still rendering... Active Status. (Elapsed: ${polls * 15}s / 180s)`);
       } else {
          log.warn(`Veo API: Unrecognized status: ${pollData.status}`);
       }
       
       // ACTION: Add a 15-second delay between checks
       await new Promise(r => setTimeout(r, 15000));
    }

    if (!finalVideoBytes) {
       throw new Error("Veo Engine Error: Timed out after 180 seconds.");
    }
    
    const buffer = Buffer.from(finalVideoBytes.replace(/^data:\w+\/\w+;base64,/, ""), "base64");
    fs.writeFileSync(outputPath, buffer);
    
    return 'Google Veo 3.1';
  } catch (error) {
    throw new Error(`Veo Engine Error: ${error.message}`);
  }
}

function extractKeywords(prompt) {
  let cleaned = (prompt || '').replace(/^(A|An|The)\s+/i, '');
  cleaned = cleaned.split(',')[0].trim();
  const words = cleaned.split(' ').filter(w => w.length > 2);
  return words.slice(0, 3).join(' ');
}

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

async function fetchPollinationsImage(prompt, outputPath) {
  await delay(POLLINATIONS_COOLDOWN_MS); // 5s Cooldown block
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;
  await downloadFile(url, outputPath);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size < 10000) throw new Error('Pollinations image too small');
  return 'Pollinations.ai';
}

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

async function acquireImage(prompt, outputPath, sceneIndex) {
  const keywords = extractKeywords(prompt);

  try {
    log.info(`Scene ${sceneIndex}: Pollinations AI → "${prompt.substring(0, 50)}..."`);
    const provider = await withRetry(() => fetchPollinationsImage(prompt, outputPath), { maxRetries: 2, name: `pollinations-${sceneIndex}` });
    return { provider, attribution: 'Image by Pollinations.ai' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Pollinations failed. Trying Pexels Image...`);
  }

  try {
    const provider = await fetchPexelsImage(keywords, outputPath);
    return { provider, attribution: 'Photo by Pexels' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Pexels Image failed. Trying Pixabay...`);
  }

  try {
    const provider = await fetchPixabayImage(keywords, outputPath);
    return { provider, attribution: 'Image by Pixabay' };
  } catch (err) {
    log.error(`Scene ${sceneIndex}: All traditional image providers failed. Deploying invincible placeholder.`);
    
    // Extreme Fallback
    const fallbackUrl = 'https://source.unsplash.com/1080x1920/?technology,abstract';
    await downloadFile(fallbackUrl, outputPath);
    return { provider: 'Unsplash Static Placeholder', attribution: 'Image by Unsplash' };
  }
}

async function acquireVideo(query, videoPath, imageFallbackPath, sceneIndex) {
  try {
    log.info(`Scene ${sceneIndex}: Google Veo 3.1 → "${query}"`);
    const provider = await withRetry(async () => {
      try {
        return await fetchVeoVideo(query, videoPath);
      } catch (veoErr) {
        if (veoErr.message && (veoErr.message.includes('PROMINENT_PEOPLE_FILTER_FAILED') || veoErr.message.includes('INVALID_ARGUMENT'))) {
          log.warn(`⚠️ Veo safety filter triggered. Switching to abstract fallback.`);
          return await fetchVeoVideo("Abstract digital data visualization.", videoPath);
        }
        throw veoErr;
      }
    }, { maxRetries: 1, name: `veo-video-${sceneIndex}` });
    return { path: videoPath, type: 'video', provider, attribution: 'Video by Google Veo' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Google Veo 3.1 failed. Falling back to Pexels Video...`);
  }

  try {
    log.info(`Scene ${sceneIndex}: Pexels Video → "${query}"`);
    const provider = await withRetry(() => fetchPexelsVideo(query, videoPath), { maxRetries: 2, name: `pexels-video-${sceneIndex}` });
    return { path: videoPath, type: 'video', provider, attribution: 'Video by Pexels' };
  } catch (err) {
    log.warn(`Scene ${sceneIndex}: Pexels Video failed. Falling back to Pollinations image cascade...`);
  }

  const { provider, attribution } = await acquireImage(query, imageFallbackPath, sceneIndex);
  return { path: imageFallbackPath, type: 'image', provider, attribution };
}

async function acquireVisuals(scriptJson, targetDurationMs, outputDir = '/tmp/build/clips') {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const visualsArray = Array.isArray(scriptJson.visuals) ? scriptJson.visuals : (scriptJson.visuals?.clips || []);
  if (visualsArray.length === 0) {
    visualsArray.push('Cyberpunk hacker typing furiously', 'Quantum computer glowing blue', 'holographic neon sign');
  }

  log.info(`Acquiring ${visualsArray.length} hybrid visual scenes...`);
  const clips = [];

  for (let i = 0; i < visualsArray.length; i++) {
    const item = visualsArray[i];
    const query = typeof item === 'string' ? item : (item.query || item.prompt || 'technology');
    const effect = typeof item === 'string' ? 'zoom_in' : (item.effect || 'zoom_in');
    const type = typeof item === 'string' ? 'video' : (item.type || 'video');

    try {
      if (type === 'video') {
        const videoPath = path.join(outputDir, `scene_${i}.mp4`);
        const imgPath = path.join(outputDir, `scene_${i}.jpg`);
        const result = await acquireVideo(query, videoPath, imgPath, i + 1);
        clips.push({ ...result, effect, durationMs: 0 });
      } else {
        const imgPath = path.join(outputDir, `scene_${i}.jpg`);
        const { provider, attribution } = await acquireImage(query, imgPath, i + 1);
        clips.push({ path: imgPath, type: 'image', effect, provider, attribution, durationMs: 0 });
      }
    } catch (err) {
      log.error(`Scene ${i + 1} processing error — skipping: ${err.message}`);
    }
  }

  // The Resilient Engine update: Proceed as long as we have literally any clips
  if (clips.length === 0) {
    throw new Error(`VISUAL_ACQUISITION_FAILED: Zero scenes acquired. Even placeholders failed.`);
  }

  const durationPerClip = Math.round(targetDurationMs / clips.length);
  clips.forEach(c => { c.durationMs = durationPerClip; });

  log.info(`Visuals complete: ${clips.length} scenes acquired. Duration set to ~${Math.round(durationPerClip / 1000)}s each.`);

  const attributions = [...new Set(clips.map(c => c.attribution))];
  return { clips, provider: 'hybrid', attributions };
}

async function generateHeroThumbnail(topic, outputPath) {
  const prompt = `High-contrast, vibrant colors, minimal background, glowing centered tech icon, 9:16, ultra-detailed ${topic}`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;
  
  try {
    await withRetry(() => downloadFile(url, outputPath), { maxRetries: 2, name: 'hero-thumbnail' });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) return true;
    throw new Error('Placeholder generated');
  } catch (err) {
    log.error(`Hero Thumbnail generation failed: ${err.message}`);
    return false;
  }
}

module.exports = { acquireVisuals, generateHeroThumbnail };
