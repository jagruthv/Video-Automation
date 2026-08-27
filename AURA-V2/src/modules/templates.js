// src/modules/templates.js
const fs = require('fs');
const path = require('path');

const BACKGROUNDS_DIR = path.join(__dirname, '../../resources/backgrounds');

function getRandomBackground() {
    if (!fs.existsSync(BACKGROUNDS_DIR)) return null;
    const files = fs.readdirSync(BACKGROUNDS_DIR).filter(f => f.endsWith('.mp4'));
    if (files.length === 0) return null;
    return path.join(BACKGROUNDS_DIR, files[Math.floor(Math.random() * files.length)]);
}

const TEMPLATES = {
    STANDARD: {
        id: 'STANDARD',
        ratio: '1080x1920',
        width: 1080,
        height: 1920,
        subtitleMarginV: 960,
    },

    /**
     * GAMING_OVERLAY — New high-retention layout (replaces old BRAINROT_SPLIT default)
     * Layout (1080x1920 canvas):
     *   - 5% top (96px): gaming background bleeds through — immersive
     *   - 16:9 content window (1080x607): overlaid at y=96
     *   - Remaining bottom: gaming background fills below content
     * Subtitles sit in the gaming zone below the content panel.
     */
    GAMING_OVERLAY: {
        id: 'GAMING_OVERLAY',
        ratio: '1080x1920',
        width: 1080,
        height: 1920,
        // Content panel: 16:9 = 1080x607, starts at y=96 (5% = 96px gap)
        contentY: 96,
        contentW: 1080,
        contentH: 607,
        subtitleMarginV: 180, // Positioned in the gaming zone below content
    },

    /**
     * GAMING_LEGACY — Original 50/50 split (archived, low-performing)
     * Kept for backward-compat (existing warehouse blueprints use this ID).
     */
    GAMING_LEGACY: {
        id: 'GAMING_LEGACY',
        ratio: '1080x1080',
        width: 1080,
        height: 1080,
        subtitleMarginV: 400,
    },

    // Backward-compat alias so old blueprints with templateId='BRAINROT_SPLIT' still render
    BRAINROT_SPLIT: {
        id: 'GAMING_LEGACY',
        ratio: '1080x1080',
        width: 1080,
        height: 1080,
        subtitleMarginV: 400,
    },

    FULLSCREEN_BG: {
        id: 'FULLSCREEN_BG',
        ratio: '1080x1920',
        width: 1080,
        height: 1920,
        subtitleMarginV: 960,
    },

    /**
     * IMAGE_SHORT — Meme / pic short format
     * Single high-quality image fills screen, Ken Burns zoom/pan effect,
     * energetic music clip underneath. No narration, no subtitles.
     * Duration = energetic music clip length (auto-cut 15–30s).
     */
    IMAGE_SHORT: {
        id: 'IMAGE_SHORT',
        ratio: '1080x1920',
        width: 1080,
        height: 1920,
        durationFromMusic: true,  // no voice — duration set by music clip
        noNarration: true,
        noSubtitles: true,
    },
};

module.exports = { TEMPLATES, getRandomBackground };
