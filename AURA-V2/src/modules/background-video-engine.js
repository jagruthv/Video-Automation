const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Resolve bundled ffmpeg/ffprobe paths (same pattern as assembly-engine)
const FFMPEG_PATH = (() => { try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch {} return 'ffmpeg'; })();
const FFPROBE_PATH = (() => { try { const p = require('@ffprobe-installer/ffprobe').path; if (p && fs.existsSync(p)) return p; } catch {} return 'ffprobe'; })();

const MANIFEST_PATH = path.join(__dirname, '../../assets/background-manifest.json');
// We use a dynamic getter for manifest so changes to the JSON apply without full server reboot.
function getManifest() {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}
const manifest = getManifest();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Get the duration of a video file in seconds via ffprobe.
 */
function getVideoDuration(filePath) {
    try {
        const result = spawnSync(FFPROBE_PATH, [
            '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', filePath
        ], { encoding: 'utf8', timeout: 10000 });
        const parsed = parseFloat(result.stdout.trim());
        if (isNaN(parsed) || parsed <= 0) throw new Error(`Bad output: ${result.stdout.trim()}`);
        return parsed;
    } catch (e) {
        console.warn(`[BG-VIDEO] ⚠️ Could not measure duration of ${path.basename(filePath)}: ${e.message}`);
        return 0;
    }
}

/**
 * Extracts background footage from one OR multiple source clips.
 * - Single string: loops the clip with -stream_loop -1 (safe for long sand videos).
 * - Array of paths: re-encodes each clip to uniform format via filter_complex concat,
 *   then applies speed via setpts. No codec mismatch, no looping required.
 */
async function extractSegment(sourceData, outputPath, startSec, neededSec, speed) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const ptsSpeed = (1 / speed).toFixed(6);

    const isMulti = Array.isArray(sourceData) && sourceData.length > 1;

    if (isMulti) {
        // ── MULTI-CLIP: filter_complex concat (re-encode all to uniform stream) ──
        const totalSourceNeeded = neededSec * speed;  // total raw seconds we need across all clips
        const durPerClip = totalSourceNeeded / sourceData.length;

        // Build spawnSync args array — safe for paths with spaces
        const ffmpegArgs = ['-y'];
        const scaleFilters = [];
        for (let i = 0; i < sourceData.length; i++) {
            const clipDur    = getVideoDuration(sourceData[i]);
            const maxStart   = Math.max(0, clipDur - durPerClip - 1);
            const randomStart = (maxStart > 0 ? Math.random() * maxStart : 0).toFixed(2);
            const safeRead   = (durPerClip + 0.5).toFixed(2);
            ffmpegArgs.push('-ss', randomStart, '-t', safeRead, '-i', sourceData[i]);
            scaleFilters.push(`[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v${i}]`);
        }

        const concatPads    = sourceData.map((_, i) => `[v${i}]`).join('');
        const filterComplex = [
            ...scaleFilters,
            `${concatPads}concat=n=${sourceData.length}:v=1:a=0[vcat]`,
            `[vcat]setpts=${ptsSpeed}*PTS[vout]`
        ].join(';');

        ffmpegArgs.push(
            '-filter_complex', filterComplex,
            '-map', '[vout]',
            '-t', neededSec.toFixed(2),
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an',
            '-movflags', '+faststart',
            outputPath
        );

        const result = spawnSync(FFMPEG_PATH, ffmpegArgs, { timeout: 600000, stdio: 'pipe' });
        if (result.status !== 0) throw new Error(`FFmpeg multi-clip failed: ${(result.stderr||Buffer.alloc(0)).toString().slice(-400)}`);
        console.log(`[BG-VIDEO] ✅ Multi-clip concat (${sourceData.length} clips) → ${neededSec.toFixed(1)}s at ${speed.toFixed(2)}x → ${path.basename(outputPath)}`);
        return;
    }

    // ── SINGLE-CLIP: original stream_loop approach (for sand or solo fallback) ──
    const sourceDuration = neededSec * speed;

    let atempoFilters = '';
    let remaining = speed;
    while (remaining > 1.0) {
        const step = Math.min(remaining, 2.0);
        atempoFilters += `,atempo=${step.toFixed(4)}`;
        remaining /= step;
    }

    const sourcePath = Array.isArray(sourceData) ? sourceData[0] : sourceData;
    const singleArgs = [
        '-y',
        '-ss', startSec.toFixed(2),
        '-t', sourceDuration.toFixed(2),
        '-stream_loop', '-1', '-i', sourcePath,
        '-vf', `setpts=${ptsSpeed}*PTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`,
        '-af', `aresample=44100${atempoFilters}`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath
    ];
    const r = spawnSync(FFMPEG_PATH, singleArgs, { timeout: 600000, stdio: 'pipe' });
    if (r.status !== 0) throw new Error(`FFmpeg single-clip failed: ${(r.stderr||Buffer.alloc(0)).toString().slice(-400)}`);
    console.log(`[BG-VIDEO] ✅ Extracted ${neededSec.toFixed(1)}s segment at ${speed}x → ${path.basename(outputPath)}`);
}

/**
 * SAND MODE — Extract a random segment from the 12hr kinetic sand video.
 * Speed: 1.5x (very slow video, needs acceleration)
 */
async function getSandSegment(outputPath, sceneDurationSec) {
    const config = manifest.modes.sand;
    if (!fs.existsSync(config.path)) {
        throw new Error(`Sand video not found at ${config.path}`);
    }
    const totalDuration = getVideoDuration(config.path);
    const randomStart = Math.random() * totalDuration;

    await extractSegment(config.path, outputPath, randomStart, sceneDurationSec, config.speed);
    return { provider: 'bg_sand', path: outputPath };
}

/**
 * PINTEREST MODE — Smart-select a clip from the 300 accepted vault clips.
 * Speed: 2x. Smart selection: picks clips whose source duration is >= needed duration.
 */
async function getPinterestSegment(outputPath, sceneDurationSec) {
    const manifest = getManifest();
    const config = manifest.modes.pinterest;
    if (!fs.existsSync(config.library_dir)) {
        throw new Error(`Pinterest library not found at ${config.library_dir}`);
    }

    const allClips = fs.readdirSync(config.library_dir)
        .filter(f => f.endsWith('.mp4'))
        .map(f => path.join(config.library_dir, f));

    if (allClips.length === 0) throw new Error('Pinterest library is empty');

    // Random speed between 1.5x and 2.0x for variety
    const speed = 1.5 + Math.random() * 0.5;

    // Shuffle all clips, then pick dynamically based on how much raw footage is needed.
    // Each clip contributes roughly 20s of raw footage at the chosen speed.
    // e.g. 65s video @ 1.7x needs ~110s raw → ~5-6 clips. 30s @ 1.5x needs ~45s raw → ~2-3 clips.
    const rawFootageNeeded = sceneDurationSec * speed;
    const targetClips = Math.max(2, Math.min(8, Math.ceil(rawFootageNeeded / 20)));

    const shuffled = allClips.sort(() => 0.5 - Math.random());
    const selectedClips = shuffled.slice(0, Math.min(targetClips, shuffled.length));

    if (selectedClips.length === 1) {
        const dur = getVideoDuration(selectedClips[0]);
        const randomStart = Math.random() * dur;
        console.log(`[BG-VIDEO] 🎬 Pinterest: 1 clip — "${path.basename(selectedClips[0])}" at ${speed.toFixed(2)}x`);
        await extractSegment(selectedClips[0], outputPath, randomStart, sceneDurationSec, speed);
    } else {
        console.log(`[BG-VIDEO] 🎬 Pinterest: Stitching ${selectedClips.length} clips (~${rawFootageNeeded.toFixed(0)}s raw needed) at ${speed.toFixed(2)}x`);
        await extractSegment(selectedClips, outputPath, 0, sceneDurationSec, speed);
    }
    return { provider: 'bg_pinterest', path: outputPath };
}

/**
 * MINECRAFT MODE — Download a random Minecraft clip from CDN or use local cache.
 * Speed: 1.25x
 */
async function getMinecraftSegment(outputPath, sceneDurationSec) {
    const manifest = getManifest();
    const config = manifest.modes.minecraft;
    const cacheDir = config.local_cache_dir;
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    // First, try local cache
    const cachedFiles = fs.existsSync(cacheDir)
        ? fs.readdirSync(cacheDir).filter(f => f.endsWith('.mp4'))
        : [];

    let sourcePath = null;
    
    if (cachedFiles.length > 0) {
        const rawFootageNeeded = sceneDurationSec * config.speed;
        const targetClips = Math.max(2, Math.min(8, Math.ceil(rawFootageNeeded / 20)));
        const shuffled = cachedFiles.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, Math.min(targetClips, shuffled.length));
        if (selected.length === 1) {
            sourcePath = path.join(cacheDir, selected[0]);
            console.log(`[BG-VIDEO] 🎬 Minecraft: 1 clip — "${selected[0]}"`);
        } else {
            sourcePath = selected.map(f => path.join(cacheDir, f));
            console.log(`[BG-VIDEO] 🎬 Minecraft: Stitching ${selected.length} clips (~${rawFootageNeeded.toFixed(0)}s raw needed)`);
        }
    }

    // Only download if NO cached files exist at all
    if (!sourcePath) {
        const idx = Math.floor(Math.random() * config.cdn_max_index) + 1;
        const url = config.cdn_base.replace('{n}', idx);
        const dest = path.join(cacheDir, `Minecraft_${idx}.mp4`);
        console.log(`[BG-VIDEO] 📥 Downloading Minecraft clip ${idx} from CDN...`);
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
            if (!res.ok) throw new Error(`CDN HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(dest, buf);
            sourcePath = dest;
        } catch (e) {
            console.warn(`[BG-VIDEO] ⚠️ Minecraft CDN download failed: ${e.message}. Attempting offline library fallback...`);
            const fallbackDir = path.join(__dirname, '../../resources/backgrounds');
            if (fs.existsSync(fallbackDir)) {
                const defaults = fs.readdirSync(fallbackDir).filter(f => f.endsWith('.mp4'));
                if (defaults.length > 0) {
                    const randomDefault = defaults[Math.floor(Math.random() * defaults.length)];
                    sourcePath = path.join(fallbackDir, randomDefault);
                    console.log(`[BG-VIDEO] ✅ Using offline fallback: ${randomDefault}`);
                }
            }
            if (!sourcePath) {
                throw new Error(`Minecraft CDN failed and no offline fallback found.`);
            }
        }
    }

    if (Array.isArray(sourcePath)) {
        await extractSegment(sourcePath, outputPath, 0, sceneDurationSec, config.speed);
    } else {
        const totalDuration = getVideoDuration(sourcePath);
        const randomStart = Math.random() * totalDuration;
        await extractSegment(sourcePath, outputPath, randomStart, sceneDurationSec, config.speed);
    }
    return { provider: 'bg_minecraft', path: outputPath };
}

/**
 * MAIN EXPORT: Get a background video segment based on the configured mode.
 * @param {string} mode - 'sand' | 'minecraft' | 'pinterest'
 * @param {string} outputPath - Where to save the extracted segment
 * @param {number} sceneDurationSec - How many seconds of output are needed
 */
async function getBackgroundSegment(mode, outputPath, sceneDurationSec) {
    const effectiveMode = mode || manifest.default_mode;
    console.log(`[BG-VIDEO] 🎞️ Generating ${effectiveMode} background (${sceneDurationSec.toFixed(1)}s)...`);

    switch (effectiveMode) {
        case 'sand':      return getSandSegment(outputPath, sceneDurationSec);
        case 'gaming':
        case 'minecraft': return getMinecraftSegment(outputPath, sceneDurationSec);
        case 'pinterest': return getPinterestSegment(outputPath, sceneDurationSec);
        default:
            throw new Error(`Unknown background mode: ${effectiveMode}`);
    }
}

module.exports = { getBackgroundSegment, getVideoDuration };
