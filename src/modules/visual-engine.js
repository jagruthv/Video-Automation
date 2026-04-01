'use strict';

const fs = require('fs');
const path = require('path');
const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const log = getModuleLogger('visual-engine');

/**
 * Download a file from URL to local path.
 * @param {string} url
 * @param {string} outputPath
 * @returns {Promise<void>}
 */
async function downloadFile(url, outputPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

// ============================================================
// TIER 1: Pexels Video API — PRIMARY
// Corrected: 200 req/hour, 20,000 req/month (free)
// ============================================================
async function fetchPexelsVideos(keywords, outputDir) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY not set');

  const clips = [];

  for (const keyword of keywords) {
    if (clips.length >= 3) break; // Enough clips

    try {
      const res = await withRetry(async () => {
        const r = await fetch(
          `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&orientation=portrait&size=medium&per_page=5`,
          {
            headers: { 'Authorization': apiKey },
            signal: AbortSignal.timeout(10000)
          }
        );
        if (!r.ok) throw new Error(`Pexels HTTP ${r.status}`);
        return r.json();
      }, { maxRetries: 2, name: `pexels-${keyword}` });

      const videos = (res.videos || []).filter(v =>
        v.duration >= 8 && v.width >= 720
      );

      for (const video of videos.slice(0, 2)) {
        // Prefer HD quality file
        const hdFile = video.video_files.find(f =>
          f.quality === 'hd' && f.width >= 720
        ) || video.video_files[0];

        if (!hdFile?.link) continue;

        const clipPath = path.join(outputDir, `pexels_${video.id}.mp4`);
        await downloadFile(hdFile.link, clipPath);

        clips.push({
          path: clipPath,
          durationMs: (video.duration || 10) * 1000,
          type: 'video',
          source: `pexels-${video.id}`,
          attribution: `Video by ${video.user?.name || 'Pexels'} from Pexels`
        });

        log.info(`Pexels: Downloaded clip ${video.id} (${video.duration}s)`);
        if (clips.length >= 3) break;
      }
    } catch (err) {
      log.warn(`Pexels search "${keyword}" failed: ${err.message}`);
    }
  }

  return clips;
}

// ============================================================
// TIER 2: Pixabay Video API — FALLBACK
// ============================================================
async function fetchPixabayVideos(keywords, outputDir) {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) throw new Error('PIXABAY_API_KEY not set');

  const clips = [];

  for (const keyword of keywords) {
    if (clips.length >= 3) break;

    try {
      const res = await withRetry(async () => {
        const r = await fetch(
          `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(keyword)}&video_type=film&per_page=5`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (!r.ok) throw new Error(`Pixabay HTTP ${r.status}`);
        return r.json();
      }, { maxRetries: 2, name: `pixabay-${keyword}` });

      for (const hit of (res.hits || []).slice(0, 2)) {
        if ((hit.duration || 0) < 5) continue;

        const videoUrl = hit.videos?.medium?.url || hit.videos?.small?.url;
        if (!videoUrl) continue;

        const clipPath = path.join(outputDir, `pixabay_${hit.id}.mp4`);
        await downloadFile(videoUrl, clipPath);

        clips.push({
          path: clipPath,
          durationMs: (hit.duration || 10) * 1000,
          type: 'video',
          source: `pixabay-${hit.id}`,
          attribution: `Video by ${hit.user || 'Pixabay'} from Pixabay`
        });

        log.info(`Pixabay: Downloaded clip ${hit.id} (${hit.duration}s)`);
        if (clips.length >= 3) break;
      }
    } catch (err) {
      log.warn(`Pixabay search "${keyword}" failed: ${err.message}`);
    }
  }

  return clips;
}

// ============================================================
// TIER 3: Pollinations.ai Image Generation — EMERGENCY FALLBACK
// Free, no API key, URL-based
// ============================================================
async function fetchPollinationsImages(sceneDescriptions, outputDir) {
  const clips = [];

  for (let i = 0; i < sceneDescriptions.length && i < 4; i++) {
    const scene = sceneDescriptions[i];
    try {
      const prompt = `${scene.description}, cinematic, 9:16 aspect ratio, photorealistic, 4K, dramatic lighting`;
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;

      const imgPath = path.join(outputDir, `pollination_${i}.jpg`);
      await withRetry(async () => {
        await downloadFile(url, imgPath);
        // Verify file is valid (> 10KB)
        const stat = fs.statSync(imgPath);
        if (stat.size < 10000) throw new Error('Image too small — likely generation failed');
      }, { maxRetries: 2, name: `pollinations-scene-${i}`, baseDelay: 3000 });

      // Parse timestamp to get duration for Ken Burns
      const tsMatch = scene.timestamp?.match(/(\d+)-(\d+)s/);
      const durationMs = tsMatch
        ? (parseInt(tsMatch[2]) - parseInt(tsMatch[1])) * 1000
        : 12000;

      clips.push({
        path: imgPath,
        durationMs,
        type: 'image',
        source: `pollinations-${i}`,
        attribution: 'Generated by Pollinations.ai'
      });

      log.info(`Pollinations: Generated scene ${i} image`);
    } catch (err) {
      log.warn(`Pollinations scene ${i} failed: ${err.message}`);
    }
  }

  return clips;
}

// ============================================================
// MAIN VISUAL ACQUISITION — 3-TIER CASCADE
// ============================================================

/**
 * Acquire background visuals for a video.
 * Tries Pexels → Pixabay → Pollinations in order.
 *
 * @param {Object} scriptJson - LLM script output with visual_keywords_for_pexels and visual_scene_descriptions
 * @param {number} targetDurationMs - Target duration to match audio
 * @param {string} outputDir - Directory to save clips
 * @returns {Promise<{clips: Array, provider: string, attributions: string[]}>}
 */
async function acquireVisuals(scriptJson, targetDurationMs, outputDir = '/tmp/build/clips') {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const keywords = scriptJson.visual_keywords_for_pexels || ['technology', 'code', 'futuristic'];
  const scenes = scriptJson.visual_scene_descriptions || [];

  let clips = [];
  let provider = 'none';
  const attributions = [];

  // TIER 1: Pexels
  if (process.env.PEXELS_API_KEY) {
    try {
      clips = await fetchPexelsVideos(keywords, outputDir);
      if (clips.length > 0) {
        provider = 'pexels';
        clips.forEach(c => attributions.push(c.attribution));
      }
    } catch (err) {
      log.warn(`Pexels tier failed entirely: ${err.message}`);
    }
  }

  // TIER 2: Pixabay
  if (clips.length < 2 && process.env.PIXABAY_API_KEY) {
    try {
      const pixClips = await fetchPixabayVideos(keywords, outputDir);
      clips.push(...pixClips);
      if (pixClips.length > 0) provider = provider || 'pixabay';
      pixClips.forEach(c => attributions.push(c.attribution));
    } catch (err) {
      log.warn(`Pixabay tier failed entirely: ${err.message}`);
    }
  }

  // TIER 3: Pollinations (AI-generated images)
  if (clips.length < 2) {
    try {
      const pollClips = await fetchPollinationsImages(
        scenes.length > 0 ? scenes : [
          { timestamp: '0-15s', description: 'Abstract technology visualization' },
          { timestamp: '15-35s', description: 'Digital data streams and networks' },
          { timestamp: '35-55s', description: 'Futuristic holographic display' }
        ],
        outputDir
      );
      clips.push(...pollClips);
      if (pollClips.length > 0) provider = provider || 'pollinations';
      pollClips.forEach(c => attributions.push(c.attribution));
    } catch (err) {
      log.warn(`Pollinations tier failed entirely: ${err.message}`);
    }
  }

  if (clips.length === 0) {
    throw new Error('ALL_VISUAL_PROVIDERS_EXHAUSTED — no clips or images acquired');
  }

  // Adjust clips total duration to match target
  let totalClipDuration = clips.reduce((sum, c) => sum + c.durationMs, 0);

  if (totalClipDuration < targetDurationMs && clips.length > 0) {
    // Loop the last clip to fill remaining time
    const lastClip = clips[clips.length - 1];
    lastClip.durationMs += (targetDurationMs - totalClipDuration);
    lastClip.loop = true;
    log.info(`Extended last clip to fill ${targetDurationMs - totalClipDuration}ms gap`);
  }

  log.info(`Visuals acquired: ${clips.length} clips from ${provider}, total ~${Math.round(targetDurationMs / 1000)}s`);
  return { clips, provider, attributions };
}

module.exports = { acquireVisuals };
