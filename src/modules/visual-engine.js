'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const log = getModuleLogger('visual-engine');

/**
 * Download a file from URL to local path.
 */
async function downloadFile(url, outputPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

/**
 * Smart Keyword Extraction for Stock API
 */
function extractKeywords(prompt) {
  let cleaned = prompt.replace(/^(A|An|The)\s+/i, '');
  cleaned = cleaned.split(',')[0].trim();
  const words = cleaned.split(' ').filter(w => w.length > 2);
  return words.slice(0, 3).join(' ');
}

/**
 * Fetch a Pexels Video
 */
async function fetchPexelsVideo(query, outputPath) {
  if (!process.env.PEXELS_API_KEY) throw new Error('PEXELS_API_KEY not set for video fetching');
  const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=large&per_page=3`, {
    headers: { 'Authorization': process.env.PEXELS_API_KEY }
  });
  if (!res.ok) throw new Error(`Pexels Video HTTP ${res.status}`);
  const data = await res.json();
  if (data.videos && data.videos.length > 0) {
    const video = data.videos[Math.floor(Math.random() * data.videos.length)];
    const file = video.video_files.find(f => f.quality === 'hd') || video.video_files[0];
    await downloadFile(file.link, outputPath);
    return 'Pexels Video';
  }
  throw new Error('No videos found');
}

/**
 * Fallback to Pexels or Pixabay Image
 */
async function fetchStockImage(prompt, outputPath) {
  const query = extractKeywords(prompt);
  log.info(`Pollinations failed. Stock Fallback: searching for "${query}"`);

  if (process.env.PEXELS_API_KEY) {
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=3`, {
        headers: { 'Authorization': process.env.PEXELS_API_KEY }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.photos && data.photos.length > 0) {
          const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
          await downloadFile(photo.src.portrait || photo.src.large, outputPath);
          return 'Pexels';
        }
      }
    } catch (err) { log.warn(`Pexels fallback failed: ${err.message}`); }
  }

  if (process.env.PIXABAY_API_KEY) {
    try {
      const res = await fetch(`https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=vertical`);
      if (res.ok) {
        const data = await res.json();
        if (data.hits && data.hits.length > 0) {
          const hit = data.hits[Math.floor(Math.random() * Math.min(data.hits.length, 3))];
          await downloadFile(hit.largeImageURL, outputPath);
          return 'Pixabay';
        }
      }
    } catch (err) { log.warn(`Pixabay fallback failed: ${err.message}`); }
  }

  throw new Error('Stock API fallback exhausted or keys not configured');
}

/**
 * Acquire visuals natively mixing Pexels Videos and Pollinations Images
 */
async function acquireVisuals(scriptJson, targetDurationMs, outputDir = '/tmp/build/clips') {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const visualsArray = scriptJson.visuals || [
    { type: 'image', prompt: 'Cyberpunk hacker typing furiously', effect: 'zoom_in' },
    { type: 'video', query: 'matrix code', effect: 'pan_right' },
    { type: 'image', prompt: 'holographic neon sign', effect: 'glitch' }
  ];

  log.info(`Generating ${visualsArray.length} hybrid visual items...`);
  const clips = [];

  for (let i = 0; i < visualsArray.length; i++) {
    const item = visualsArray[i];
    const effect = item.effect || 'zoom_in';
    const isVideo = item.type === 'video';
    const extension = isVideo ? 'mp4' : 'jpg';
    const mediaPath = path.join(outputDir, `scene_${i}.${extension}`);
    
    let sourceProvider = 'unknown';
    let attributionText = '';

    if (isVideo) {
      try {
        const query = item.query || item.prompt || 'technology';
        await withRetry(() => fetchPexelsVideo(query, mediaPath), { maxRetries: 2, name: `video-${i}`, baseDelay: 2000 });
        sourceProvider = 'pexels-video';
        attributionText = 'Video by Pexels';
      } catch (err) {
        log.warn(`Failed to fetch video for ${item.query}, downgrading to image fallback: ${err.message}`);
        // Fallback to stock image if video fails
        try {
          const stock = await fetchStockImage(item.query, mediaPath.replace('.mp4', '.jpg'));
          sourceProvider = `stock-${stock}`;
          attributionText = `Visual by ${stock}`;
        } catch (e) { log.error(`Video and fallback image failed: ${e.message}`); continue; }
      }
    } else {
      try {
        const prompt = item.prompt || item.query || 'technology';
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;
        await withRetry(async () => {
          await downloadFile(url, mediaPath);
          if (fs.statSync(mediaPath).size < 10000) throw new Error('Image too small');
        }, { maxRetries: 2, name: `pollinations-img-${i}`, baseDelay: 2000 });
        sourceProvider = 'pollinations';
        attributionText = 'Image by Pollinations.ai';
      } catch (err) {
        log.warn(`Pollinations failed for ${item.prompt}, falling back to stock API: ${err.message}`);
        try {
          const stock = await fetchStockImage(item.prompt, mediaPath);
          sourceProvider = `stock-${stock}`;
          attributionText = `Visual by ${stock}`;
        } catch (e) { log.error(`All image fetching failed: ${e.message}`); continue; }
      }
    }

    const finalPath = fs.existsSync(mediaPath) ? mediaPath : mediaPath.replace('.mp4', '.jpg');
    if (fs.existsSync(finalPath)) {
      clips.push({
        path: finalPath,
        type: finalPath.endsWith('.mp4') ? 'video' : 'image',
        effect,
        source: sourceProvider,
        attribution: attributionText
      });
      log.info(`Acquired scene ${i+1}/${visualsArray.length}: ${finalPath} (${attributionText})`);
    }
  }

  if (clips.length < 3) {
    throw new Error('VISUAL_ACQUISITION_FAILED: Captured too few successful visual clips from providers.');
  }

  const durationPerClip = Math.round(targetDurationMs / clips.length);
  clips.forEach(c => { c.durationMs = durationPerClip; });

  log.info(`Visuals complete: ${clips.length} scenes, ~dividing ${Math.round(targetDurationMs / 1000)}s total audio into chunks`);
  
  // Mixed attribution list
  const attributions = [...new Set(clips.map(c => c.attribution))];
  
  return { clips, provider: 'hybrid', attributions };
}

module.exports = { acquireVisuals };
