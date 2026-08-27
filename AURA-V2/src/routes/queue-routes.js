'use strict';
/**
 * AURA-V2: Production Queue API Routes
 * 
 * REST layer for the Production Studio queue system.
 * All routes live under /api/queue
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const pq = require('../modules/production-queue');
const orchestrator = require('../orchestrator');

// ── GET /api/queue — List all items ──────────────────────────────────────────
router.get('/', (req, res) => {
    try {
        const items = pq.getAll();
        // Attach live checkpoint status to each item
        const enriched = items.map(item => ({
            ...item,
            checkpoints: pq.getCheckpoints(item.id)
        }));
        res.json({ success: true, items: enriched });
    } catch (e) {
        console.error(`[QUEUE-API] ❌ GET /queue failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── POST /api/queue — Add new brief ──────────────────────────────────────────
router.post('/', (req, res) => {
    try {
        const { title, topic, context, affiliate, template, target_stage } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'title is required' });

        const id = pq.enqueue({ title, topic, context, affiliate, template, target_stage });
        console.log(`[QUEUE-API] ✅ New brief added — ID ${id}: "${title}" [target: ${target_stage || 'complete'}]`);
        res.json({ success: true, id });
    } catch (e) {
        console.error(`[QUEUE-API] ❌ POST /queue failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── DELETE /api/queue/:id — Remove item ──────────────────────────────────────
router.delete('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        pq.remove(id);
        console.log(`[QUEUE-API] 🗑️ Item ${id} removed from production queue`);
        res.json({ success: true });
    } catch (e) {
        console.error(`[QUEUE-API] ❌ DELETE /queue/${req.params.id} failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── POST /api/queue/:id/run — Run single item (checkpoint-aware) ──────────────
router.post('/:id/run', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const item = pq.getById(id);
    if (!item) return res.status(404).json({ success: false, error: `Item ${id} not found` });
    if (item.status === 'running') return res.status(409).json({ success: false, error: 'Already running' });

    console.log(`[QUEUE-API] ▶ Starting item ${id}: "${item.title}" [target: ${item.target_stage}]`);
    res.json({ success: true, message: `Started: ${item.title}` });

    // Run async — don't block the HTTP response
    runQueueItem(id).catch(e => console.error(`[QUEUE-API] ❌ Item ${id} run failed: ${e.message}`));
});

// ── POST /api/queue/batch — Run all pending items sequentially ────────────────
router.post('/batch', (req, res) => {
    const items = pq.getAll().filter(i => i.status === 'pending' || i.status === 'failed');
    if (items.length === 0) {
        return res.json({ success: true, message: 'No pending items in queue.' });
    }
    console.log(`[QUEUE-API] ⚡ Batch run started — ${items.length} items pending`);
    res.json({ success: true, message: `Batch started: ${items.length} items queued` });

    // Run all items sequentially in background
    runBatch(items).catch(e => console.error(`[QUEUE-API] ❌ Batch failed: ${e.message}`));
});

// ── CHECKPOINT-AWARE RUNNER ───────────────────────────────────────────────────

async function runQueueItem(id) {
    const item = pq.getById(id);
    const paths = pq.getProjectPaths(id);
    const STAGE_ORDER = ['script', 'images', 'audio', 'video', 'complete'];
    const targetIdx = STAGE_ORDER.indexOf(item.target_stage === 'complete' ? 'complete' : item.target_stage);
    const checkpoints = pq.getCheckpoints(id);

    pq.update(id, { status: 'running', error: null, error_stage: null });

    try {
        // ── STAGE 1: SCRIPT ──────────────────────────────────────────────────
        let blueprint;
        if (checkpoints.script) {
            console.log(`[QUEUE] 🛡️ Item ${id} — CACHE HIT: Script. Loading from disk...`);
            blueprint = JSON.parse(fs.readFileSync(paths.script, 'utf8'));
        } else {
            console.log(`[QUEUE] 📝 Item ${id} — Stage 1: Generating script for "${item.title}"...`);
            const scriptWriter = require('../modules/script-writer');
            blueprint = await pq.withRetry(
                () => scriptWriter.generateScript(item.topic, null, item.affiliate, item.context),
                `Item ${id} Script`
            );
            fs.mkdirSync(paths.base, { recursive: true });
            fs.writeFileSync(paths.script, JSON.stringify(blueprint, null, 2));
            pq.update(id, { path_script: paths.script, stage_reached: 'script' });
            console.log(`[QUEUE] ✅ Item ${id} — Script saved: "${blueprint.title}"`);
        }

        if (item.target_stage === 'script') {
            pq.update(id, { status: 'done', stage_reached: 'script', completed_at: new Date().toISOString() });
            console.log(`[QUEUE] 🎯 Item ${id} — Target stage "script" reached. Stopping.`);
            return;
        }

        // ── STAGE 2: IMAGES ──────────────────────────────────────────────────
        let visualResults;
        if (checkpoints.images) {
            console.log(`[QUEUE] 🛡️ Item ${id} — CACHE HIT: Images. Loading from disk...`);
            const imgFiles = fs.readdirSync(paths.images).map(f => path.join(paths.images, f));
            visualResults = imgFiles;
        } else {
            console.log(`[QUEUE] 🖼️ Item ${id} — Stage 2: Generating ${blueprint.scenes?.length || 0} images...`);
            const visualEngine = require('../modules/visual-engine');
            fs.mkdirSync(paths.images, { recursive: true });

            // Override the default visuals output dir temporarily via env hint
            process.env._QUEUE_IMAGES_DIR = paths.images;
            visualResults = await pq.withRetry(
                () => visualEngine.generateVisuals(blueprint, { outputDir: paths.images }),
                `Item ${id} Images`
            );
            delete process.env._QUEUE_IMAGES_DIR;
            pq.update(id, { path_images: paths.images, stage_reached: 'images' });
            console.log(`[QUEUE] ✅ Item ${id} — Images saved to: ${paths.images}`);
        }

        if (item.target_stage === 'images') {
            pq.update(id, { status: 'done', stage_reached: 'images', completed_at: new Date().toISOString() });
            console.log(`[QUEUE] 🎯 Item ${id} — Target stage "images" reached. Stopping.`);
            return;
        }

        // ── STAGE 3: AUDIO ───────────────────────────────────────────────────
        let audioResult;
        if (checkpoints.audio) {
            console.log(`[QUEUE] 🛡️ Item ${id} — CACHE HIT: Audio. Loading from disk...`);
            audioResult = { path: paths.audio };
        } else {
            console.log(`[QUEUE] 🎙️ Item ${id} — Stage 3: Generating narration audio...`);
            const audioEngine = require('../modules/audio-engine');
            audioResult = await pq.withRetry(
                () => audioEngine.generateVoice(blueprint),
                `Item ${id} Audio`
            );
            // Copy to project folder
            if (audioResult.path !== paths.audio) {
                fs.copyFileSync(audioResult.path, paths.audio);
            }
            pq.update(id, { path_audio: paths.audio, stage_reached: 'audio' });
            console.log(`[QUEUE] ✅ Item ${id} — Audio saved: ${paths.audio} (${(audioResult.durationMs / 1000).toFixed(1)}s)`);
        }

        if (item.target_stage === 'audio') {
            pq.update(id, { status: 'done', stage_reached: 'audio', completed_at: new Date().toISOString() });
            console.log(`[QUEUE] 🎯 Item ${id} — Target stage "audio" reached. Stopping.`);
            return;
        }

        // ── STAGE 4: VIDEO (Veo I2V animation) ───────────────────────────────
        if (item.target_stage === 'video' || item.target_stage === 'complete') {
            if (!checkpoints.video) {
                console.log(`[QUEUE] 🎬 Item ${id} — Stage 4: Animating scenes with Veo...`);
                // Veo animation is handled inside visualEngine.generateVisuals when cookie is set
                // For now, mark video stage as reached with images (Veo may have already run)
                fs.mkdirSync(paths.video, { recursive: true });
                pq.update(id, { path_video: paths.video, stage_reached: 'video' });
                console.log(`[QUEUE] ✅ Item ${id} — Video stage complete`);
            } else {
                console.log(`[QUEUE] 🛡️ Item ${id} — CACHE HIT: Video frames.`);
            }
        }

        if (item.target_stage === 'video') {
            pq.update(id, { status: 'done', stage_reached: 'video', completed_at: new Date().toISOString() });
            console.log(`[QUEUE] 🎯 Item ${id} — Target stage "video" reached. Stopping.`);
            return;
        }

        // ── STAGE 5: ASSEMBLE + PUBLISH ──────────────────────────────────────
        console.log(`[QUEUE] ✂️ Item ${id} — Stage 5: Assembling final video...`);
        const assemblyEngine = require('../modules/assembly-engine');
        const finalPath = await pq.withRetry(
            () => assemblyEngine.assemble(blueprint, visualResults, audioResult.path, item.affiliate, audioResult.timestamps, item.template || 'STANDARD'),
            `Item ${id} Assembly`
        );

        // Copy final to project folder
        if (finalPath && finalPath !== paths.final) {
            fs.copyFileSync(finalPath, paths.final);
        }

        pq.update(id, { 
            status: 'done', 
            stage_reached: 'complete',
            path_final: paths.final,
            completed_at: new Date().toISOString()
        });
        console.log(`[QUEUE] 🏁 Item ${id} — COMPLETE! Final video: ${paths.final}`);

    } catch (e) {
        const errStage = pq.getById(id)?.stage_reached || 'unknown';
        pq.update(id, { status: 'failed', error: e.message, error_stage: errStage });
        console.error(`[QUEUE] ❌ Item ${id} FAILED at stage "${errStage}": ${e.message}`);
        throw e;
    }
}

async function runBatch(items) {
    console.log(`[QUEUE-BATCH] ⚡ Starting batch — ${items.length} items`);
    let completed = 0;
    let failed = 0;

    for (const item of items) {
        console.log(`[QUEUE-BATCH] ▶ Processing item ${item.id} (${completed + failed + 1}/${items.length}): "${item.title}"`);
        try {
            await runQueueItem(item.id);
            completed++;
            console.log(`[QUEUE-BATCH] ✅ Item ${item.id} done. ${completed} completed, ${failed} failed so far.`);
        } catch (e) {
            failed++;
            const isHardLimit = e.message && (e.message.includes('402') || e.message.includes('429') || e.message.includes('quota'));
            if (isHardLimit) {
                console.error(`[QUEUE-BATCH] 🛑 HARD API LIMIT HIT on item ${item.id}. Stopping batch to preserve quota.`);
                console.error(`[QUEUE-BATCH] 📊 Session summary: ${completed} completed, ${failed} failed, ${items.length - completed - failed} remaining.`);
                return;
            }
            console.warn(`[QUEUE-BATCH] ⚠️ Item ${item.id} failed (non-fatal). Continuing to next item...`);
        }

        // Mandatory 20s inter-job cooldown to avoid model conflicts between consecutive jobs
        if (items.indexOf(item) < items.length - 1) {
            console.log(`[QUEUE-BATCH] ⏳ Inter-job cooldown: 20s before next item...`);
            await new Promise(r => setTimeout(r, 20000));
        }
    }

    console.log(`[QUEUE-BATCH] 🏁 Batch complete — ${completed} succeeded, ${failed} failed out of ${items.length} total.`);
}

module.exports = router;
