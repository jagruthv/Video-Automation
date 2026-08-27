const fs = require('fs');
const path = require('path');
const https = require('https');
const { architectSearchQuery } = require('./script-writer');
const { fetchWikimediaImage } = require('./wikimedia-fetcher');
const { getBackgroundSegment } = require('./background-video-engine');
require('dotenv').config();

// Configuration
const VISUALS_OUTPUT_DIR = path.join(__dirname, '../../tmp/visuals');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// High-Efficiency Safe Throttlers
const throttlers = {
    pollinations: { last: 0, delay: 0 }, // Handled explicitly post-execution
    hf_inference: { last: 0, delay: 6000 }
};

let isHFDepleted = false;           // Global flag for current mission session
let isBYOPDepleted = false;         // Pollinations BYOP sk_ key balance flag
let isPollinationsFreeFailed = false; // Skip free tier after first 401/failure
let lastBYOPCall = 0;
const BYOP_THROTTLE_MS = 10000; // 10s between BYOP calls as requested


// ─── Helper: Download any binary URL to disk ────────────────────────────────
async function downloadBinaryToFile(url, destPath) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' downloading ' + url);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1000) throw new Error('Downloaded file suspiciously small (' + buffer.length + ' bytes)');
    fs.writeFileSync(destPath, buffer);
}

// ─── Helper: Safe file move/copy ────────────────────────────────────────────
async function safeFileOperation(src, dest, op) {
    if (op === 'move') { fs.renameSync(src, dest); }
    else { fs.copyFileSync(src, dest); }
}

// ─── Helper: Throttle by provider key ───────────────────────────────────────
async function throttle(providerKey) {
    const t = throttlers[providerKey];
    if (!t) return;
    const wait = t.delay - (Date.now() - t.last);
    if (wait > 0) await sleep(wait);
    t.last = Date.now();
}

// ─── Helper: Check PROVIDERS_ENABLED .env flag ──────────────────────────────
function isProviderEnabled(name) {
    const enabled = (process.env.PROVIDERS_ENABLED || '').split(',').map(function(s){ return s.trim().toLowerCase(); });
    return enabled.includes(name.toLowerCase());
}

// ─── Provider: Pollinations Free (anonymous) ────────────────────────────────
async function fetchPollinations(prompt, width, height, seed, outputPath) {
    if (isPollinationsFreeFailed) throw new Error('Pollinations Free already failed this session');
    const fallbackUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?width=' + width + '&height=' + height + '&seed=' + seed + '&nologo=true';
    try {
        await downloadBinaryToFile(fallbackUrl, outputPath);
    } catch (e) {
        if (e.message && (e.message.includes('401') || e.message.includes('403'))) {
            isPollinationsFreeFailed = true;
            console.warn('[POLLINATIONS] Free tier blocked — disabling for this session.');
        }
        throw e;
    }
    return { provider: 'pollinations_free', path: outputPath };
}

// ─── Provider: Pollinations BYOP (sk_ key — 10/hr budget) ───────────────────
async function fetchPollinationsBYOP(prompt, width, height, seed, outputPath) {
    const key = process.env.POLLINATIONS_BYOP_KEY;
    if (!key || !key.startsWith('sk_') || isBYOPDepleted) {
        throw new Error('BYOP unavailable (no sk_ key or depleted)');
    }

    const now = Date.now();
    const wait = BYOP_THROTTLE_MS - (now - lastBYOPCall);
    if (wait > 0) {
        console.log('[BYOP] Rate Throttle: Waiting ' + Math.ceil(wait / 1000) + 's before next call (10s gap enforced)...');
        await sleep(wait);
    }
    lastBYOPCall = Date.now();

    try {
        const balRes = await fetch('https://enter.pollinations.ai/api/account/balance', {
            headers: { 'Authorization': 'Bearer ' + key }
        });
        if (balRes.ok) {
            const balData = await balRes.json();
            if (balData.balance !== undefined && balData.balance <= 0) {
                isBYOPDepleted = true;
                throw new Error('BYOP balance depleted');
            }
            console.log('[BYOP] Budget OK — ' + balData.balance + ' pollen remaining this hour.');
        }
    } catch (e) {
        if (e.message === 'BYOP balance depleted') throw e;
    }

    const url = 'https://gen.pollinations.ai/image/' + encodeURIComponent(prompt) + '?model=flux&width=' + width + '&height=' + height + '&seed=' + seed + '&nologo=true';
    const response = await fetch(url, { headers: { 'Authorization': 'Bearer ' + key } });

    if (response.status === 402) { isBYOPDepleted = true; throw new Error('BYOP 402 — depleted'); }
    if (!response.ok) throw new Error('BYOP HTTP ' + response.status);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log('[BYOP] SUCCESS — Image saved (' + Math.round(buffer.length / 1024) + 'KB) via Pollinations BYOP.');
    return { provider: 'pollinations_byop', path: outputPath };
}

// ─── Provider: HuggingFace FLUX ─────────────────────────────────────────────
async function fetchHF(prompt, outputPath) {
    const token = process.env.HF_TOKEN;
    if (!token) throw new Error('HF_TOKEN not set');
    await throttle('hf_inference');
    const url = 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';
    const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ inputs: prompt }),
    });
    if (!response.ok) {
        const errText = await response.text();
        if (response.status === 402) { isHFDepleted = true; }
        throw new Error('HF API error (' + response.status + '): ' + errText.slice(0, 100));
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return { provider: 'hugging_face', path: outputPath };
}

// ─── Provider: Pexels Image search ──────────────────────────────────────────
async function searchPexelsImage(query, outputPath, isSquare) {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) throw new Error('Pexels disabled (No Key)');
    const orientation = isSquare ? 'square' : 'portrait';
    const response = await fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=5&orientation=' + orientation, {
        headers: { 'Authorization': apiKey }
    });
    const data = await response.json();
    if (!data.photos || data.photos.length === 0) throw new Error('No Pexels images found');
    const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
    await downloadBinaryToFile(photo.src.large2x, outputPath);
    return { provider: 'pexels', path: outputPath };
}

// ─── Provider: Pexels Video search ──────────────────────────────────────────
async function searchPexelsVideo(query, outputPath, isSquare) {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) throw new Error('Pexels Video disabled');
    console.log('[PEXELS] Searching for ' + (isSquare ? 'Square' : 'Vertical') + ' video: "' + query + '"');
    const safeQuery = query.replace(/\n/g, ' ');
    const url = 'https://api.pexels.com/videos/search?query=' + encodeURIComponent(safeQuery) + '&per_page=5&orientation=' + (isSquare ? 'square' : 'portrait');
    const response = await fetch(url, { headers: { 'Authorization': apiKey } });
    const data = await response.json();
    let videos = data.videos;
    if (!videos || videos.length === 0) {
        const broadResponse = await fetch('https://api.pexels.com/videos/search?query=' + encodeURIComponent(safeQuery.split(' ').slice(0, 2).join(' ')) + '&per_page=5', {
            headers: { 'Authorization': apiKey }
        });
        const broadData = await broadResponse.json();
        if (!broadData.videos || broadData.videos.length === 0) throw new Error('No Pexels videos found');
        videos = broadData.videos;
    }
    const video = videos[0];
    let videoUrl = video.video_files.find(function(f){ return f.quality === 'sd' || f.quality === 'hd'; });
    videoUrl = videoUrl ? videoUrl.link : (video.video_files[0] ? video.video_files[0].link : null);
    if (!videoUrl) throw new Error('Pexels video object contained no file links.');
    await downloadBinaryToFile(videoUrl, outputPath);
    return { provider: 'pexels_video', path: outputPath };
}


/**
 * Priority 1: Veo 3.1 I2V Animation
 * Pattern matched exactly to verified working test (verify_veo_i2v.mjs)
 */
async function tryVeoAnimation(imgPath, prompt, outputPath, index, options = {}) {
    const cookie = process.env.GOOGLE_WHISK_COOKIE_VIDEO;
    if (!cookie) {
        throw new Error('Veo disabled — GOOGLE_WHISK_COOKIE_VIDEO not set in .env');
    }
    if (!imgPath || !fs.existsSync(imgPath)) {
        throw new Error(`Veo skipped: base image not found at ${imgPath}`);
    }

    try {
        console.log(`[VEO] 🌌 Scene ${index + 1}: Authenticating with Whisk...`);

        const { Account } = require(path.resolve(__dirname, '../../node_modules/@rohitaryal/whisk-api/dist/Whisk.js'));
        const { Media }   = require(path.resolve(__dirname, '../../node_modules/@rohitaryal/whisk-api/dist/Media.js'));

        // Step 1: Auth — same as working test
        const account = new Account(cookie);
        await account.refresh();
        console.log(`[VEO] ✅ Scene ${index + 1}: Auth OK (${account.userEmail || 'authenticated'})`);

        // Step 2: Read base image as base64
        const base64 = fs.readFileSync(imgPath).toString('base64');

        // Step 3: Construct Media — ONLY the fields the working test uses
        const googleAspectRatio = options?.isSquare
            ? 'IMAGE_ASPECT_RATIO_SQUARE'
            : 'IMAGE_ASPECT_RATIO_PORTRAIT';

        const media = new Media({
            encodedMedia: base64,
            prompt: prompt,
            aspectRatio: googleAspectRatio,
            mediaType: 'IMAGE',
            account: account
        });

        console.log(`[VEO] ⏳ Scene ${index + 1}: Sending to Veo 3.1 I2V (${googleAspectRatio})...`);

        // Step 4: Animate
        const video = await media.animate(prompt, 'VEO_3_1_I2V_12STEP');

        // Step 5: Save
        const tmpDir = path.dirname(outputPath);
        const savedPath = video.save(tmpDir);

        if (fs.existsSync(savedPath)) {
            await safeFileOperation(savedPath, outputPath, 'move');
            console.log(`[VEO] 🎬 Scene ${index + 1}: SUCCESS — Video saved (${Math.round((fs.statSync(outputPath).size) / 1024)}KB)`);
            return { path: outputPath, provider: 'veo' };
        }

        throw new Error('Veo rendered but output file was not found on disk');

    } catch (e) {
        if (e.message?.includes('PUBLIC_ERROR_UNSAFE_GENERATION')) {
            console.warn(`[VEO] 🛡️ Scene ${index + 1}: Safety filtered by Google — skipping.`);
        } else if (e.message?.includes('cookie') || e.message?.includes('auth') || e.message?.includes('401') || e.message?.includes('403')) {
            console.error(`[VEO] 🍪 Scene ${index + 1}: Cookie expired or invalid — ${e.message}`);
            console.error(`[VEO] → Get a fresh GOOGLE_WHISK_COOKIE_VIDEO from your browser and update .env`);
        } else {
            console.error(`[VEO] ❌ Scene ${index + 1}: ${e.message}`);
        }
        throw e;
    }
}


/**
 * Priority 2: Modal Lightning
 */
async function animateSceneModal(prompt, outputPath, index) {
    console.log(`[VISUAL-MODAL] ⚡ Scene ${index + 1}: Cloud Rendering (AnimateDiff-Lightning)...`);

    // Correct class-based Modal URL structure: workspace--app-class--hash/
    const endpoint = "https://vanteddujagruth2406--titanium-vision-engine-videoengine--ca67e9.modal.run/";

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt }),
        signal: AbortSignal.timeout(120000)
    });

    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`Modal returned non-JSON: ${text.slice(0, 100)}`);
    }

    if (data.status === "success" && data.video_base64) {
        fs.writeFileSync(outputPath, Buffer.from(data.video_base64, 'base64'));
        return outputPath;
    }
    throw new Error(`Modal render failed: ${data.status || 'Unknown error'}`);
}

async function animateScene(imgPath, scene, blueprint, index, options = {}) {
    const outputPath = path.join(VISUALS_OUTPUT_DIR, `scene_${index}.mp4`);

    // ATOMIC CACHE SHIELD: Skip GPU credits if video already exists from previous attempt
    if (fs.existsSync(outputPath)) {
        console.log(`[VISUAL-SHIELD] 🛡️ Scene ${index + 1}: Found cached motion. Skipping GPU credit burn.`);
        return { path: outputPath, veoFailed: false };
    }

    const imagePrompt = `${scene.image_prompt}, ${blueprint.global_style_anchor}`;
    const videoPrompt = `${scene.video_prompt || scene.image_prompt}, ${blueprint.global_style_anchor}`;
    const isSquare = options.aspectRatio === '1080x1080';
    const enrichedOptions = { ...options, isSquare };
    let veoFailed = false;

    // TIER 0: Seedance 1.5 Pro (OpenRouter) — requires PROVIDERS_ENABLED=seedance
    if (isProviderEnabled('seedance')) {
        try {
            const result = await tryOpenRouterVideo(imgPath, videoPrompt, outputPath, index);
            if (result) return { path: result.path, veoFailed: false };
        } catch (e) {
            console.warn(`[VISUAL-SHIELD] 🛡️ Seedance Tier Failed for Scene ${index + 1}: ${e.message}`);
        }
    } else {
        console.log(`[VISUAL-SHIELD] 🔒 Seedance disabled (not in PROVIDERS_ENABLED). Skipping.`);
    }

    // TIER 1: Veo (Google — requires PROVIDERS_ENABLED=google_veo)
    if (options.veoAllowed !== false && isProviderEnabled('google_veo')) {
        try {
            const result = await tryVeoAnimation(imgPath, videoPrompt, outputPath, index, enrichedOptions);
            if (result) return { path: result.path, veoFailed: false };
        } catch (e) {
            console.warn(`[VISUAL-SHIELD] 🛡️ Veo Tier Failed for Scene ${index + 1}: ${e.message}`);
            veoFailed = true;
        }
    } else if (!isProviderEnabled('google_veo')) {
        console.log(`[VISUAL-SHIELD] 🔒 Google Veo locked (not in PROVIDERS_ENABLED). Skipping.`);
    }

    // TIER 2: Modal Lightning (GPU AI)
    try {
        console.warn(`[VISUAL-SHIELD] 🛑 GPU Engine (Modal) manually disabled for this mission. Bypassing...`);
        throw new Error('GPU Disabled by User');

        // // HARDENING: Combine the high-detail image prompt with the high-velocity motion prompt
        // const hardenedPrompt = `${scene.motion_prompt || 'Dynamic cinematic movement'}, ${scene.image_prompt}`;
        // const path = await animateSceneModal(hardenedPrompt, outputPath, index);
        // return { path, veoFailed };
    } catch (e) {
        console.warn(`[VISUAL-SHIELD] 🛡️ Modal Tier Skipped for Scene ${index + 1}: ${e.message}`);
    }

    // TIER 3: Pexels Video (Stock Motion Fallback)
    try {
        const condensedSearch = await architectSearchQuery(imagePrompt);
        const query = condensedSearch || `${blueprint.core_entity} cinematic`;

        const result = await searchPexelsVideo(query, outputPath, isSquare);
        console.log(`[VISUAL-SHIELD] 🎬 Scene ${index + 1}: Restored via Pexels Video (${query}).`);
        return { path: result.path, veoFailed };
    } catch (e) {
        console.warn(`[VISUAL-SHIELD] ⚠️ Pexels Video Failed for Scene ${index + 1}: ${e.message}`);
    }

    // TIER 4: Background Video Fallback (Pinterest, Sand, Minecraft)
    try {
        const bgMode = process.env.BG_VIDEO_MODE || 'pinterest';
        console.log(`[VISUAL-SHIELD] 🎬 Scene ${index + 1}: Falling back to Background Video Engine (${bgMode})...`);
        // We request a 5s segment; assembly-engine will trim/loop it perfectly later
        const result = await getBackgroundSegment(bgMode, outputPath, 5.0);
        return { path: result.path, veoFailed: true };
    } catch (e) {
        console.warn(`[VISUAL-SHIELD] ⚠️ Background Video Failed for Scene ${index + 1}: ${e.message}`);
    }

    // TIER 5: Static AI Image (The 'Dual-Core' frame)
    console.warn(`[VISUAL-SHIELD] 🖼️ ALL MOTION TIERS FAILED. Falling back to primary AI Image for Scene ${index + 1}.`);
    return { path: null, veoFailed };
}

/**
 * DUAL-CORE MARATHON PIPELINE v7.0
 * Producer-Consumer: images generate sequentially (30s gaps),
 * animation fires per-scene as image lands (max 2 Veo concurrent),
 * with full checkpoint support for crash recovery.
 */
async function generateVisuals(blueprint, options = {}) {
    const db = require('./db');
    const scenesCount = blueprint.scenes.length;
    const missionId = options.missionId || `${Date.now()}_${(blueprint.core_entity || 'mission').replace(/\s+/g, '_').toLowerCase()}`;

    // ── Per-mission isolated directory ─────────────────────────────────────────
    // Each warehouse entry gets its own sub-folder, so multiple in-progress
    // missions never overwrite each other's scene files.
    const missionDir = path.join(VISUALS_OUTPUT_DIR, missionId);
    if (!fs.existsSync(missionDir)) fs.mkdirSync(missionDir, { recursive: true });

    console.log(`[ZERO-CREDIT] 🏆 Initiating Unified Zero-Credit Pipeline (Wikipedia -> Pexels -> BYOP)`);
    console.log(`[ZERO-CREDIT] 📋 Mission ID: ${missionId} | Scenes: ${scenesCount} | Dir: .../${missionId}`);

    const results = new Array(scenesCount).fill(null);
    let deferQueue = [];
    const usedWikipediaImages = new Set();

    // ── Build execution queue with 2-layer crash recovery ───────────────────
    // Layer 1: DISK-FIRST — survives CMD kills, crashes, missionId changes.
    //          If the file physically exists and is non-trivial in size → valid.
    // Layer 2: DB CHECKPOINT — used when disk was cleaned but DB record remains.
    for (let i = 0; i < scenesCount; i++) {
        const diskVid = path.join(missionDir, `scene_${i}.mp4`);
        const diskImg = path.join(missionDir, `scene_${i}.jpg`);

        if (fs.existsSync(diskVid) && fs.statSync(diskVid).size > 10240) {
            console.log(`[CHECKPOINT] 💾 Scene ${i + 1}: Video on disk (${Math.round(fs.statSync(diskVid).size/1024)}KB) — skipping.`);
            results[i] = { sceneIndex: i, image: null, video: diskVid, type: 'video' };
            continue;
        }
        if (fs.existsSync(diskImg) && fs.statSync(diskImg).size > 1024) {
            console.log(`[CHECKPOINT] 💾 Scene ${i + 1}: Image on disk (${Math.round(fs.statSync(diskImg).size/1024)}KB) — skipping.`);
            results[i] = { sceneIndex: i, image: diskImg, video: null, type: 'image' };
            continue;
        }

        // Layer 2: DB checkpoint (fallback if disk was cleaned externally)
        const ckpt = db.getSceneCheckpoint(missionId, i);
        if (ckpt?.video_status === 'done' && fs.existsSync(ckpt.video_path)) {
            console.log(`[CHECKPOINT] 🗄️ Scene ${i + 1}: DB record hit — skipping.`);
            results[i] = { sceneIndex: i, image: null, video: ckpt.video_path, type: 'video' };
        } else if (ckpt?.image_status === 'done' && fs.existsSync(ckpt.image_path)) {
            console.log(`[CHECKPOINT] 🗄️ Scene ${i + 1}: DB record hit — skipping.`);
            results[i] = { sceneIndex: i, image: ckpt.image_path, video: null, type: 'image' };
        } else {
            deferQueue.push({ index: i, attempts: 0 });
        }
    }

    while (deferQueue.length > 0) {
        const item = deferQueue.shift();
        const i = item.index;
        const scene = blueprint.scenes[i];
        
        // Determine if scene is factual or abstract
        const isFactual = scene.real_world_subject && scene.real_world_subject !== 'null';
        const query = isFactual ? scene.real_world_subject : blueprint.core_entity;
        
        const imgOut = path.join(missionDir, `scene_${i}.jpg`);
        const vidOut = path.join(missionDir, `scene_${i}.mp4`);

        let assetPath = null;
        let isVideo = false;

        // TIER 1 & 2 & 3: Real world searches (ONLY if scene has a factual subject)
        if (isFactual) {
            // TIER 1: Wikipedia (Capped at 2 per video to preserve AI flow)
            try {
                if (usedWikipediaImages.size >= 2) {
                    throw new Error('Wikipedia cap reached (MAX 2). Bypassing to AI generator');
                }
                console.log(`[WIKIPEDIA] 🔎 Scene ${i + 1}: Searching Wikipedia for "${query}"...`);
                const fetchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&prop=pageimages&piprop=original&format=json&pithumbsize=1000`;
                const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
                const data = await res.json();
                const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
                const pageWithImg = pages.find(p => 
                    p.original && 
                    p.original.source && 
                    !p.original.source.toLowerCase().endsWith('.svg') && 
                    !usedWikipediaImages.has(p.original.source)
                );
                if (!pageWithImg) throw new Error('No unused raster Wikipedia image for query');
                usedWikipediaImages.add(pageWithImg.original.source);
                await downloadBinaryToFile(pageWithImg.original.source, imgOut);
                console.log(`[WIKIPEDIA] ✅ Scene ${i + 1}: Acquired "${pageWithImg.title}"`);
                assetPath = imgOut; isVideo = false;
            } catch (wikiErr) {
                console.warn(`[WIKIPEDIA] ⚠️ Scene ${i + 1}: ${wikiErr.message}. Trying BYOP...`);
            }
        } else {
            console.log(`[PIPELINE] 🎨 Scene ${i + 1}: Abstract prompt detected. Bypassing Wikipedia.`);
        }

        const byopPrompt = `${scene.visualPrompt || scene.image_prompt || scene.description}, ${blueprint.global_style_anchor || 'cinematic'}`;
        const imgW = 1080;
        const imgH = options.aspectRatio === '1080x1080' ? 1080 : 1920;

        // TIER 2: Pollinations BYOP
        if (!assetPath) {
            try {
                console.log(`[BYOP] 🖼️ Scene ${i + 1}: Generating AI image via BYOP...`);
                const resBYOP = await fetchPollinationsBYOP(byopPrompt, imgW, imgH, blueprint.global_seed, imgOut);
                console.log(`[BYOP] ✅ Scene ${i + 1}: BYOP AI image acquired.`);
                assetPath = resBYOP.path; isVideo = false;
            } catch (byopErr) {
                if (byopErr.message.includes('depleted') || byopErr.message.includes('unavailable')) {
                    console.warn(`[BYOP] ⚠️ Scene ${i + 1}: BYOP depleted/unavailable — falling back to Free Pollinations.`);
                } else {
                    console.warn(`[BYOP] ⚠️ Scene ${i + 1}: BYOP failed: ${byopErr.message}. Falling back to Free Pollinations.`);
                }
            }
        }

        // TIER 3: Pollinations Free (Fallback if BYOP fails/depletes)
        if (!assetPath) {
            try {
                console.log(`[FREE-POLLINATIONS] 🖼️ Scene ${i + 1}: Generating via Pollinations Free...`);
                // Use a slightly different seed so it doesn't cache the exact same failure
                const freeSeed = blueprint.global_seed + i + Math.floor(Math.random() * 100);
                const freeUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(byopPrompt)}?width=${imgW}&height=${imgH}&seed=${freeSeed}&nologo=true`;
                
                const res = await fetch(freeUrl, { signal: AbortSignal.timeout(60_000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                
                const buf = Buffer.from(await res.arrayBuffer());
                if (buf.length > 5000) {
                    fs.writeFileSync(imgOut, buf);
                    console.log(`[FREE-POLLINATIONS] ✅ Scene ${i + 1}: Free AI image acquired (${Math.round(buf.length/1024)}KB).`);
                    assetPath = imgOut; isVideo = false;
                } else {
                    throw new Error('Image response too small');
                }
            } catch (freeErr) {
                console.warn(`[FREE-POLLINATIONS] ⚠️ Scene ${i + 1}: Failed: ${freeErr.message}. Trying Pexels...`);
            }
        }

        // Removed Pexels completely per user request

        // TIER 5: Background Video (Absolute last resort if BYOP is depleted)
        if (!assetPath) {
            try {
                const bgMode = process.env.BG_VIDEO_MODE || 'pinterest';
                console.log(`[VISUAL-SHIELD] 🎬 Scene ${i + 1}: Falling back to Background Video (${bgMode})...`);
                const resBg = await getBackgroundSegment(bgMode, vidOut, 5.0);
                assetPath = resBg.path; isVideo = true;
            } catch (bgErr) {
                console.warn(`[VISUAL-SHIELD] ❌ Scene ${i + 1}: Background fallback failed: ${bgErr.message}`);
            }
        }

        if (!assetPath) {
            console.error(`[PIPELINE] 💀 Scene ${i + 1}: ALL tiers exhausted. Scene will be missing.`);
        }

        // Save checkpoint
        if (assetPath) {
            if (isVideo) db.upsertSceneCheckpoint(missionId, i, { video_path: assetPath, video_status: 'done' });
            else db.upsertSceneCheckpoint(missionId, i, { image_path: assetPath, image_status: 'done' });
        }

        results[i] = {
            sceneIndex: i,
            image: isVideo ? null : assetPath,
            video: isVideo ? assetPath : null,
            type: isVideo ? 'video' : 'image'
        };
        
        // Anti-rate-limit breather
        if (deferQueue.length > 0) await sleep(5000);
    }
    
    console.log(`[PIPELINE] ✅ Phase 3.1 Complete: All zero-credit assets gathered.`);
    return results;
}

async function generateThumbnail(blueprint) {
    const outputPath = path.join(VISUALS_OUTPUT_DIR, `thumbnail.jpg`);
    const prompt = blueprint.thumbnail_prompt || `${blueprint.core_entity} viral documentary thumbnail, cinematic high-res 8k, extreme detail`;
    
    console.log(`[PIPELINE] 🖼️ Generating Best-in-Class Thumbnail (Imagen 3.5)...`);
    
    // TIER 1: Google Imagen — requires PROVIDERS_ENABLED=google_veo
    if (isProviderEnabled('google_veo')) {
        try {
            const cookie = process.env.GOOGLE_WHISK_COOKIE_IMAGE;
            if (!cookie) throw new Error("No Imagen cookie");
            
            const { Whisk }   = require(path.resolve(__dirname, '../../node_modules/@rohitaryal/whisk-api/dist/Whisk.js'));
            const { Media }   = require(path.resolve(__dirname, '../../node_modules/@rohitaryal/whisk-api/dist/Media.js'));
            const whisk = new Whisk(cookie);
            const project = await whisk.newProject(`AURA-THUMBNAIL`);
            
            const baseImage = await project.generateImage({
                prompt: prompt,
                aspectRatio: "IMAGE_ASPECT_RATIO_PORTRAIT"
            });
            
            const savedPath = baseImage.save(VISUALS_OUTPUT_DIR);
            if (savedPath && fs.existsSync(savedPath)) {
                await safeFileOperation(savedPath, outputPath, 'move');
                console.log(`[PIPELINE] ✅ Thumbnail generated via Google Imagen (1280x720).`);
                return outputPath;
            }
            throw new Error('Imagen save returned no valid path');
        } catch (e) {
            console.warn(`[PIPELINE] ⚠️ Imagen Thumbnail failed: ${e.message}. Falling to BYOP...`);
        }
    } else {
        console.log(`[PIPELINE] 🔒 Google Imagen locked (not in PROVIDERS_ENABLED). Skipping to BYOP.`);
    }

    // TIER 2: Pollinations BYOP
    if (!isBYOPDepleted) {
        let attempts = 0;
        let success = false;
        while (attempts < 3 && !success) {
            attempts++;
            try {
                console.log(`[PIPELINE] 🖼️ Thumbnail fallback: Trying Pollinations BYOP (Attempt ${attempts}/3)...`);
                await fetchPollinationsBYOP(prompt, 1080, 1920, blueprint.global_seed, outputPath);
                console.log(`[PIPELINE] ✅ Vertical Thumbnail generated via Pollinations BYOP.`);
                success = true;
                return outputPath;
            } catch (e) {
                console.warn(`[PIPELINE] ⚠️ BYOP Thumbnail failed: ${e.message}`);
                if (e.message.includes('unavailable') || e.message.includes('depleted')) break;
                if (attempts < 3) await sleep(5000);
            }
        }
    }

    // TIER 3: Pollinations Free
    if (!isPollinationsFreeFailed) {
        try {
            console.log(`[PIPELINE] 🖼️ Thumbnail fallback: Trying Pollinations Free...`);
            const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&seed=${blueprint.global_seed}&nologo=true`;
            await downloadBinaryToFile(fallbackUrl, outputPath);
            console.log(`[PIPELINE] ✅ Vertical Thumbnail generated via Pollinations Free.`);
            return outputPath;
        } catch (e) {
            console.warn(`[PIPELINE] ⚠️ Free Pollinations Thumbnail failed: ${e.message}. Falling to HF Flux...`);
        }
    }

    // TIER 4: Hugging Face Flux (Final safety)
    try {
        console.log(`[PIPELINE] 🖼️ Thumbnail fallback: Trying HF Flux...`);
        await fetchHF(prompt, outputPath); 
        console.log(`[PIPELINE] ✅ Thumbnail generated via HF Flux.`);
        return outputPath;
    } catch (e) {
        console.error(`[PIPELINE] 💀 CRITICAL: All thumbnail tiers failed.`);
        return null;
    }
}

module.exports = { generateVisuals, generateThumbnail };
