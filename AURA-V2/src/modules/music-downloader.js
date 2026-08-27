/**
 * AURA-V2 Music Downloader
 * Searches YouTube by song name via yt-dlp, downloads audio-only,
 * then extracts the single most energetic 15–30s window using FFmpeg RMS analysis.
 */
const { spawnSync, execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const TMP_MUSIC_DIR = path.join(__dirname, '../../tmp/music_dl');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Search YouTube for a query and download audio only.
 * Returns the path to the downloaded MP3 file, or throws on failure.
 */
async function downloadByQuery(query) {
    ensureDir(TMP_MUSIC_DIR);

    const safeQuery = query.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 80);
    const outTemplate = path.join(TMP_MUSIC_DIR, `%(id)s.%(ext)s`);

    console.log(`[MUSIC-DL] 🎵 Searching + downloading: "${query}"`);

    // yt-dlp: search YouTube, take first result, extract audio as MP3
    const result = spawnSync('yt-dlp', [
        `ytsearch1:${safeQuery}`,   // search top result
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',     // best quality
        '--no-playlist',
        '--no-warnings',
        '--output', outTemplate,
        '--print', 'after_move:filepath', // print final path
        '--no-progress',
    ], { encoding: 'utf8', timeout: 120_000 });

    if (result.status !== 0) {
        const err = (result.stderr || result.stdout || '').slice(0, 300);
        throw new Error(`yt-dlp failed (exit ${result.status}): ${err}`);
    }

    const downloadedPath = (result.stdout || '').trim().split('\n').pop();
    if (!downloadedPath || !fs.existsSync(downloadedPath)) {
        // Fallback: find most recently modified MP3 in tmp dir
        const files = fs.readdirSync(TMP_MUSIC_DIR)
            .filter(f => f.endsWith('.mp3'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(TMP_MUSIC_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) throw new Error('yt-dlp finished but no MP3 found in tmp dir');
        return path.join(TMP_MUSIC_DIR, files[0].name);
    }

    console.log(`[MUSIC-DL] ✅ Downloaded: ${path.basename(downloadedPath)}`);
    return downloadedPath;
}

/**
 * Analyse the audio track in WINDOW_S-second chunks, return the timestamp
 * of the single most energetic (loudest RMS) window.
 */
function findMostEnergeticStart(audioPath, windowSec = 20) {
    const ffprobePath = (() => {
        try { const p = require('@ffprobe-installer/ffprobe').path; if (p && fs.existsSync(p)) return p; } catch {}
        return 'ffprobe';
    })();

    // Get total duration first
    const durationProbe = spawnSync(ffprobePath, [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', audioPath
    ], { encoding: 'utf8', timeout: 10000 });
    const totalDuration = parseFloat(durationProbe.stdout.trim());
    if (isNaN(totalDuration) || totalDuration < windowSec) return 0; // short track → start from 0

    // Scan in 5-second steps, measure mean_volume via astats
    const ffmpegBin = 'ffmpeg';
    let bestStart = 0;
    let bestVolume = -Infinity;
    const step = 5;

    for (let t = 0; t + windowSec <= totalDuration; t += step) {
        const probe = spawnSync(ffmpegBin, [
            '-ss', String(t),
            '-t', String(windowSec),
            '-i', audioPath,
            '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
            '-f', 'null', '-'
        ], { encoding: 'utf8', timeout: 20000 });

        const matches = [...(probe.stderr + probe.stdout).matchAll(/RMS_level=(-?\d+\.?\d*)/g)];
        if (matches.length > 0) {
            const avg = matches.reduce((s, m) => s + parseFloat(m[1]), 0) / matches.length;
            if (avg > bestVolume) { bestVolume = avg; bestStart = t; }
        }
    }

    console.log(`[MUSIC-DL] 🎯 Most energetic window: t=${bestStart}s (RMS ${bestVolume.toFixed(1)} dB)`);
    return bestStart;
}

/**
 * Main export: search for a song, download it, extract the most energetic clip.
 * @param {string} query  - Song name user typed, e.g. "Blinding Lights The Weeknd"
 * @param {string} outPath - Where to save the clipped MP3
 * @param {number} clipSec - Target clip length in seconds (default 20)
 */
async function getEnergeticClip(query, outPath, clipSec = 20) {
    ensureDir(path.dirname(outPath));
    const fullPath = await downloadByQuery(query);

    const startT = findMostEnergeticStart(fullPath, clipSec);
    console.log(`[MUSIC-DL] ✂️ Extracting ${clipSec}s from t=${startT}s...`);

    // Fade in/out 0.5s to avoid harsh cuts
    const result = spawnSync('ffmpeg', [
        '-y',
        '-ss', String(startT),
        '-t', String(clipSec),
        '-i', fullPath,
        '-af', `afade=t=in:st=0:d=0.5,afade=t=out:st=${clipSec - 0.5}:d=0.5`,
        '-c:a', 'libmp3lame', '-q:a', '2',
        outPath
    ], { encoding: 'utf8', timeout: 30000 });

    if (result.status !== 0) throw new Error(`ffmpeg clip failed: ${result.stderr.slice(0, 200)}`);
    console.log(`[MUSIC-DL] ✅ Energetic clip saved: ${path.basename(outPath)}`);

    // Cleanup raw download to save disk space
    try { fs.unlinkSync(fullPath); } catch {}

    return outPath;
}

module.exports = { getEnergeticClip, downloadByQuery };
