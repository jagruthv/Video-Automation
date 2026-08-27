'use strict';
/**
 * AURA-V2: Wikimedia Commons Fetcher
 * 
 * Fetches real, licensed photos of landmarks/events from Wikipedia.
 * No API key required. Falls back gracefully if no image found.
 * 
 * Used when a scene has `real_world_subject` set (e.g. "Taj Mahal", "Kumbh Mela").
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Fetch the best image URL from Wikipedia for a given subject.
 * @param {string} subject - e.g. "Taj Mahal", "Kumbh Mela", "Tirupati Temple"
 * @returns {Promise<string|null>} - Image URL or null if not found
 */
async function getWikimediaImageUrl(subject) {
    return new Promise((resolve) => {
        const encoded = encodeURIComponent(subject);
        const options = {
            hostname: 'en.wikipedia.org',
            path: `/w/api.php?action=query&titles=${encoded}&prop=pageimages&piprop=original&pithumbsize=1200&format=json&redirects=1`,
            headers: {
                'User-Agent': 'AURA-V2/1.0 (documentary generator; contact: aura@automation.ai)'
            },
            timeout: 8000
        };

        const req = https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const pages = json?.query?.pages;
                    if (!pages) return resolve(null);

                    const page = Object.values(pages)[0];
                    if (!page || page.missing !== undefined) return resolve(null);

                    // Try original first, then thumbnail
                    const url = page?.original?.source || page?.thumbnail?.source;
                    if (!url) return resolve(null);

                    // Filter out SVGs (icons/maps), prefer photos
                    if (url.endsWith('.svg') || url.includes('.svg/')) return resolve(null);

                    resolve(url);
                } catch (e) {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

/**
 * Download a Wikimedia image to a local file path.
 * @param {string} subject - Real-world subject name
 * @param {string} outputPath - File path to save the image
 * @returns {Promise<{provider: string, path: string}|null>} 
 */
async function fetchWikimediaImage(subject, outputPath) {
    console.log(`[WIKIMEDIA] 🌍 Fetching real-world photo for: "${subject}"`);

    const imageUrl = await getWikimediaImageUrl(subject);
    if (!imageUrl) {
        console.warn(`[WIKIMEDIA] ⚠️ No image found for "${subject}". Falling back to AI.`);
        return null;
    }

    console.log(`[WIKIMEDIA] ✅ Found image: ${imageUrl.split('/').slice(-1)[0]}`);

    return new Promise((resolve) => {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const file = fs.createWriteStream(outputPath);

        const doRequest = (url) => {
            const proto = url.startsWith('https') ? https : require('http');
            proto.get(url, {
                headers: { 'User-Agent': 'AURA-V2/1.0' },
                timeout: 15000
            }, (res) => {
                // Follow redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    file.destroy();
                    fs.unlink(outputPath, () => {});
                    const redirectUrl = res.headers.location.startsWith('http')
                        ? res.headers.location
                        : `https://upload.wikimedia.org${res.headers.location}`;
                    return doRequest(redirectUrl);
                }

                if (res.statusCode !== 200) {
                    file.destroy();
                    console.warn(`[WIKIMEDIA] ⚠️ HTTP ${res.statusCode} for "${subject}". Skipping.`);
                    return resolve(null);
                }

                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    // Validate: file must be >10KB to not be a placeholder
                    const stat = fs.statSync(outputPath);
                    if (stat.size < 10240) {
                        fs.unlink(outputPath, () => {});
                        console.warn(`[WIKIMEDIA] ⚠️ Image too small (${stat.size}B). Likely an icon. Skipping.`);
                        return resolve(null);
                    }
                    console.log(`[WIKIMEDIA] 📸 Real photo saved (${Math.round(stat.size / 1024)}KB): ${outputPath}`);
                    resolve({ provider: 'wikimedia', path: outputPath });
                });
            }).on('error', () => {
                file.destroy();
                resolve(null);
            });
        };

        doRequest(imageUrl);
    });
}

module.exports = { fetchWikimediaImage, getWikimediaImageUrl };
