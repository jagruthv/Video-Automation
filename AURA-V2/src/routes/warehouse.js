'use strict';
/**
 * AURA-V2: Warehouse Routes — /api/warehouse/*
 * Batch script generation, draft listing, and resume operations.
 */
const express    = require('express');
const router     = express.Router();
const db         = require('../modules/db');
const orchestrator = require('../orchestrator');

// Template type → template id + bgMode mapping
const TEMPLATE_MAP = {
    standard:      { template: 'STANDARD',        bgMode: null },
    gaming:        { template: 'GAMING_OVERLAY',   bgMode: 'gaming' }, // Updated: GAMING_OVERLAY is new default
    gaming_legacy: { template: 'GAMING_LEGACY',    bgMode: 'gaming' },
    sand:          { template: 'FULLSCREEN_BG',    bgMode: 'sand' },
    pinterest:     { template: 'FULLSCREEN_BG',    bgMode: 'pinterest' },
};

// POST /api/warehouse/batch-generate
// Body: { allocations: [{type, count}] } OR legacy: { count, type }
router.post('/batch-generate', async (req, res) => {
    const { allocations, count, type, topic } = req.body;
    const plan = allocations || [{ type: type || 'gaming', count: parseInt(count, 10) || 1, topic }];
    const total = plan.reduce((s, a) => s + (parseInt(a.count, 10) || 0), 0);
    if (total <= 0) return res.status(400).json({ error: 'count must be > 0' });

    console.log(`[WAREHOUSE] 📦 Batch Plan: ${JSON.stringify(plan)} = ${total} total`);
    res.json({ message: `Warehouse batch started: ${total} scripts across ${plan.length} type(s).` });

    // Run asynchronously — don't block response
    (async () => {
        for (const alloc of plan) {
            const bgMode   = alloc.type || 'gaming';
            const needed   = parseInt(alloc.count, 10) || 1;
            const existing = db.getWarehouseResidues(bgMode);
            const toGen    = Math.max(0, needed - existing.length);
            const mapped   = TEMPLATE_MAP[bgMode] || { template: 'STANDARD', bgMode: null };

            console.log(`[WAREHOUSE] 📊 Type=${bgMode} | Needed=${needed} | Existing=${existing.length} | ToGenerate=${toGen}`);

            for (let i = 0; i < toGen; i++) {
                console.log(`[WAREHOUSE] 📝 Generating [${bgMode}] script ${i+1}/${toGen} (${mapped.template})...`);
                try {
                    const result = await orchestrator.start({
                        mode: 'warehouse_draft',
                        topic: alloc.topic || null,
                        template: mapped.template,
                    });
                    if (result?.isWarehouseDraft && result.blueprint) {
                        db.addWarehouseBlueprint(result.blueprint._missionId, {
                            title: result.blueprint.title, topic: alloc.topic || '',
                            template: mapped.template, bg_mode: mapped.bgMode,
                            blueprint: result.blueprint, stage: 'scripted', status: 'warehoused'
                        });
                    }
                } catch (e) { console.error(`[WAREHOUSE] ❌ Script failed: ${e.message}`); }
            }
        }
        console.log(`[WAREHOUSE] ✅ Batch complete.`);
    })();
});

// GET /api/warehouse/list
router.get('/list', (req, res) => {
    try { res.json({ success: true, data: db.getWarehouseBlueprints() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/warehouse/resume — Resume single draft
router.post('/resume', async (req, res) => {
    const { id } = req.body;
    const draft = db.getWarehouseBlueprintById(id);
    if (!draft?.blueprint_json) return res.status(404).json({ error: 'Blueprint not found' });

    console.log(`[WAREHOUSE] 🚀 Resuming ${id} from stage: ${draft.stage}`);
    db.updateWarehouseBlueprintStage(id, 'rendering', 'rendering', 'Resume triggered');

    orchestrator.start({
        mode: 'forge', resumeBlueprint: draft.blueprint_json,
        template: draft.template, warehouseId: id,
        warehouseBgMode: draft.bg_mode,       // passed as param — no global env mutation
        resumeFromAudio: draft.audio_path || null,
        resumeFromImages: draft.images_json || null,
    }).catch(e => db.updateWarehouseBlueprintStage(id, 'error', 'error', e.message, { failure_reason: e.message }));

    res.json({ message: `Pipeline resumed from stage: ${draft.stage}` });
});

// POST /api/warehouse/batch-resume — Resume multiple drafts
router.post('/batch-resume', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });

    res.json({ message: `Resuming ${ids.length} drafts.` });

    for (const id of ids) {
        const draft = db.getWarehouseBlueprintById(id);
        if (!draft?.blueprint_json) continue;
        db.updateWarehouseBlueprintStage(id, 'rendering', 'rendering', 'Bulk resume triggered');
        orchestrator.start({
            mode: 'forge', resumeBlueprint: draft.blueprint_json,
            template: draft.template, warehouseId: id,
            warehouseBgMode: draft.bg_mode,
            resumeFromAudio: draft.audio_path || null,
            resumeFromImages: draft.images_json || null,
        }).catch(e => db.updateWarehouseBlueprintStage(id, 'error', 'error', e.message, { failure_reason: e.message }));
    }
});

// DELETE /api/warehouse/:id
router.delete('/:id', (req, res) => {
    db.deleteWarehouseBlueprint(req.params.id);
    res.json({ success: true });
});

// POST /api/warehouse/stop — Abort a stuck process
router.post('/stop', (req, res) => {
    const { id } = req.body;
    db.updateWarehouseBlueprintStage(id, 'error', 'error', 'Halted manually by Operator');
    res.json({ success: true, message: 'Mission halted.' });
});

module.exports = router;
