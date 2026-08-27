'use strict';
/**
 * AURA-V2 Music Engine
 *
 * Provides mood-matched background music per content pillar.
 * Source: Pixabay Music API (free, YouTube-safe, no attribution required)
 * Cache: resources/music/{mood}.mp3 — downloaded once, reused forever.
 *
 * Falls back silently (returns null) if no API key or download fails.
 * Assembly engine handles null gracefully (voice-only output).
 */
const fs   = require('fs');
const path = require('path');

const MUSIC_DIR  = path.join(__dirname, '../../resources/music');
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;

// ── Pillar → Mood Map ────────────────────────────────────────────────────────
const PILLAR_MOOD = {
    'Real Life Drama & Betrayal':              'sad',
    'Real Crime Investigation':                'dark',
    'Real Life Survival Story':                'inspiring',
    'Historical Mystery or Lost Civilization': 'mystery',
    'Psychological Phenomenon or Experiment':  'ambient',
    'Science Anomaly or Space Discovery':      'ambient',
    'Conspiracy Theory Deep-Dive (Presented as Investigation)': 'dark',
    'Movie / TV Show Plot Breakdown':          'inspiring',
};

// ── Pixabay genre search terms (their API genre param) ───────────────────────
// Pixabay Music API: https://pixabay.com/api/docs/#api_music
const MOOD_QUERY = {
    sad:       { genre: 'classical', q: 'sad piano emotional', bpm_max: 80  },
    dark:      { genre: 'electronic', q: 'dark thriller tension suspense', bpm_max: 110 },
    inspiring: { genre: 'corporate', q: 'epic inspiring uplifting', bpm_min: 100 },
    mystery:   { genre: 'cinematic', q: 'mystery orchestral cinematic', bpm_max: 100 },
    ambient:   { genre: 'ambient',  q: 'ambient space ethereal calm', bpm_max: 90  },
};

// ── Fallback: Direct public-domain music URLs (CC0/Public Domain) ────────────
// Hosted on Internet Archive — verified stable, no bot protection, no rate limits.
const FALLBACK_URLS = {
    sad:       'https://archive.org/download/chopin-nocturne-op-9-no-2/Chopin_Nocturne_Op9_No2.mp3',
    dark:      'https://archive.org/download/78_danse-macabre_saint-saens/Danse_Macabre_Op.40.mp3',
    inspiring: 'https://archive.org/download/78_pomp-and-circumstance-march-no-1_elgar/Pomp_and_Circumstance_March_1.mp3',
    mystery:   'https://archive.org/download/gymnopedie/Gymnopedie_No_1.mp3',
    ambient:   'https://archive.org/download/debussy-clair-de-lune/Debussy_Clair_de_Lune.mp3',
};

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Get the mood string for a given content pillar.
 */
function moodForPillar(pillar) {
    return PILLAR_MOOD[pillar] || 'ambient';
}

/**
 * Download a file from a URL to a local path.
 */
async function downloadFile(url, destPath) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 10_000) throw new Error(`File too small (${buffer.length}B) — likely error page`);
    fs.writeFileSync(destPath, buffer);
    return destPath;
}

/**
 * Try to find a music track on Pixabay for the given mood.
 * Returns download URL of first match, or null.
 */
async function searchPixabay(mood) {
    if (!PIXABAY_KEY) return null;
    const cfg = MOOD_QUERY[mood] || MOOD_QUERY.ambient;
    const params = new URLSearchParams({
        key: PIXABAY_KEY,
        q: cfg.q,
        per_page: '10',
        safesearch: 'true',
    });
    if (cfg.bpm_max) params.set('bpm_max', String(cfg.bpm_max));
    if (cfg.bpm_min) params.set('bpm_min', String(cfg.bpm_min));

    try {
        const url = `https://pixabay.com/api/music/?${params.toString()}`;
        const res  = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`Pixabay HTTP ${res.status}`);
        const data = await res.json();
        if (!data.hits || data.hits.length === 0) return null;

        // Pick a random track from top 5 results for variety
        const pick = data.hits[Math.floor(Math.random() * Math.min(5, data.hits.length))];
        return pick.audio || null;
    } catch (e) {
        console.warn(`[MUSIC] ⚠️ Pixabay search failed for mood "${mood}": ${e.message}`);
        return null;
    }
}

/**
 * Get a cached music track for the given content pillar.
 * Downloads from Pixabay (or fallback) on first use, returns local path on subsequent uses.
 *
 * @param {string} pillar - Content pillar name from script-writer
 * @returns {string|null} Local path to music file, or null if unavailable
 */
async function getTrack(pillar) {
    try {
        if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

        const mood       = moodForPillar(pillar);
        const cachePath  = path.join(MUSIC_DIR, `${mood}.mp3`);

        // Return cached file if exists and is a reasonable size (>10KB)
        if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 10_000) {
            console.log(`[MUSIC] 🎵 Using cached track: ${mood} → ${path.basename(cachePath)}`);
            return cachePath;
        }

        console.log(`[MUSIC] 🔍 No cache for mood "${mood}", fetching...`);

        // Try Pixabay first
        let downloadUrl = await searchPixabay(mood);

        // Try fallback CDN if Pixabay fails or no key
        if (!downloadUrl) {
            downloadUrl = FALLBACK_URLS[mood] || FALLBACK_URLS.ambient;
            console.log(`[MUSIC] 📦 Using fallback URL for mood "${mood}"`);
        }

        await downloadFile(downloadUrl, cachePath);
        console.log(`[MUSIC] ✅ Downloaded mood "${mood}" → ${(fs.statSync(cachePath).size / 1024).toFixed(0)}KB`);
        return cachePath;

    } catch (err) {
        console.warn(`[MUSIC] ⚠️ Music unavailable for pillar "${pillar}": ${err.message}. Continuing without music.`);
        return null;
    }
}

/**
 * Force-refresh a mood track (re-download even if cached).
 * Useful for getting variety across videos.
 */
async function refreshTrack(pillar) {
    const mood      = moodForPillar(pillar);
    const cachePath = path.join(MUSIC_DIR, `${mood}.mp3`);
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
    return getTrack(pillar);
}

module.exports = { getTrack, refreshTrack, moodForPillar };
