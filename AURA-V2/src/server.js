'use strict';
/**
 * AURA-V2 Server — Entry Point
 *
 * Responsibilities of THIS file ONLY:
 *   1. Load environment + config validation
 *   2. Create Express app + global middleware
 *   3. Mount all route modules
 *   4. Start the HTTP server + background services
 *
 * ALL business logic lives in src/routes/* and src/modules/*
 */
require('dotenv').config();
require('./config');                        // Startup env validation (logs what's active)

const express      = require('express');
const path         = require('path');
const cors         = require('cors');
const db           = require('./modules/db');
const publishQueue = require('./modules/publish-queue');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security Headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// ── Global Middleware ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Route Mounts ─────────────────────────────────────────────────────────────
const orchestrator = require('./orchestrator');
const eventBus     = require('./modules/event-bus');

// Core pipeline triggers
app.post('/api/build', (req, res) => {
    const { mode, quota, duration, template, topic, affiliateLink, bgMode, contextPrompt, voice } = req.body;
    const targetCount = quota ? parseInt(quota, 10) : (duration === '6h' || mode === 'ghost') ? 36 : 1;
    console.log(`[SYSTEM] 🎯 Build: mode=${mode} | bgMode=${bgMode||'env'} | count=${targetCount} | voice=${voice || 'AUTO'}`);

    const residues = bgMode ? db.getWarehouseResidues(bgMode) : [];
    let queued = 0;
    for (const draft of residues) {
        if (queued >= targetCount) break;
        db.updateWarehouseBlueprintStage(draft.id, 'rendering', 'rendering', 'Auto-drain from build command');
        orchestrator.start({ mode: 'forge', resumeBlueprint: draft.blueprint_json, template: draft.template, warehouseId: draft.id, warehouseBgMode: draft.bg_mode, resumeFromAudio: draft.audio_path || null, resumeFromImages: draft.images_json || null })
            .catch(e => db.updateWarehouseBlueprintStage(draft.id, 'error', 'error', e.message));
        queued++;
    }
    for (let i = 0; i < targetCount - queued; i++) {
        orchestrator.start({ mode, template, topic: topic || null, affiliateLink: affiliateLink || '', contextPrompt: contextPrompt || null, warehouseBgMode: bgMode || null, voice })
            .catch(err => console.error(`[BUILD] ❌`, err.message));
    }
    res.json({ message: `Pipeline ignited. Drained ${queued} warehouse drafts + ${targetCount - queued} new missions.` });
});

app.post('/api/forge', (req, res) => {
    const { topic, script, affiliateLink, contextPrompt, template } = req.body;
    console.log(`[SYSTEM] 🛠️ Forge: ${topic || 'Custom Script'}`);
    orchestrator.start({ mode: 'forge', topic: topic || null, script: script || null, affiliateLink: affiliateLink || '', contextPrompt: contextPrompt || null, template })
        .catch(err => console.error(`[FORGE] ❌`, err.message));
    res.json({ message: 'Blueprint added to Forge. Operations grinding.' });
});

// ── Mode 8: Human-Crafted Tier-1 pipeline — inserts directly into V3 DB ──────
app.post('/api/forge/mode8', async (req, res) => {
    const { title, script, topic, voice } = req.body;
    const finalTitle  = title  || topic || 'Untitled Mode 8';
    const finalScript = script || '';
    if (!finalScript.trim() && !topic) {
        return res.status(400).json({ success: false, error: 'script or topic is required' });
    }
    try {
        const http     = require('http');
        const payload  = JSON.stringify({ title: finalTitle, script: finalScript, topic: topic || null, voice: voice || 'onyx', mode: '8' });
        const options  = { hostname: '127.0.0.1', port: 8001, path: '/ingest', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
        const v3req = http.request(options, v3res => {
            let data = '';
            v3res.on('data', chunk => data += chunk);
            v3res.on('end', () => {
                try { res.json({ success: true, ...JSON.parse(data) }); }
                catch { res.json({ success: true, message: 'Mode 8 queued in V3.' }); }
            });
        });
        v3req.on('error', err => {
            console.error('[MODE8] V3 unreachable:', err.message);
            res.status(502).json({ success: false, error: 'AURA-V3 engine is offline. Start it first.' });
        });
        v3req.write(payload);
        v3req.end();
        console.log(`[MODE8] 🎬 Queued: "${finalTitle}"`);
    } catch (err) {
        console.error('[MODE8] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/image-short', (req, res) => {
    const { imageQuery, songQuery, clipSec } = req.body;
    if (!imageQuery || !songQuery) {
        return res.status(400).json({ error: 'imageQuery and songQuery are required.' });
    }
    console.log(`[SYSTEM] 🖼️ Image Short: image="${imageQuery}" | song="${songQuery}"`);
    orchestrator.startImageShort({ imageQuery, songQuery, clipSec: parseInt(clipSec, 10) || 20 })
        .catch(err => console.error(`[IMAGE-SHORT] ❌`, err.message));
    res.json({ message: 'Image Short pipeline ignited.' });
});


// Modular route groups
app.use('/api/warehouse', require('./routes/warehouse'));
app.use('/api/queue',     require('./routes/queue-routes'));
app.use('/api/checkpoints', require('./routes/checkpoint-routes'));
app.use('/api/logs',      require('./routes/events'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/health',    require('./routes/health'));
app.use('/api/config',    require('./routes/config'));
app.use('/api',           require('./routes/library'));   // /api/db/*, /api/library, /api/video/*

// ── Background: View Watcher ─────────────────────────────────────────────────
async function startWatcherPulse() {
    console.log(`[WATCHER] 🛰️ Telemetry Engine Igniting...`);
    const { google } = require('googleapis');
    const pulse = async () => {
        try {
            const auth = new google.auth.OAuth2(process.env.YT_CLIENT_ID, process.env.YT_CLIENT_SECRET, 'http://localhost');
            auth.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });
            const yt  = google.youtube({ version: 'v3', auth });
            const res = await yt.channels.list({ part: 'statistics', mine: true });
            if (res.data.items?.length > 0) {
                const views = Number(res.data.items[0].statistics.viewCount);
                db.saveSnapshot(views);
                console.log(`[WATCHER] 🟢 Snapshot Recorded: ${views} views`);
            }
        } catch (err) {
            console.warn(`[WATCHER] ⚠️ Pulse Stalled: ${err.message}`);
        }
    };
    pulse();
    setInterval(pulse, 360_000);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
(db._dbReady || Promise.resolve()).then(() => {
    db.recoverStuckMissions();
    db.resetCrashedWarehouseEntries();
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`\n=========================================`);
        console.log(`🚀 AURA V2 ENGINE ONLINE (Port ${PORT})`);
        console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
        console.log(`=========================================\n`);
        startWatcherPulse();
        publishQueue.syncPublishQueue();
    });
});
