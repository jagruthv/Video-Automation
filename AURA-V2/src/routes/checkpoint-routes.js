/**
 * AURA-V2 Scene Checkpoint Routes
 * GET    /api/checkpoints              — list all missions
 * GET    /api/checkpoints/:missionId   — all scenes for one mission
 * DELETE /api/checkpoints/:missionId   — delete mission checkpoints + disk files
 * DELETE /api/checkpoints/:missionId/scene/:index — delete single scene + files
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../modules/db');

const VISUALS_DIR = path.join(__dirname, '../../tmp/visuals');

// GET /api/checkpoints — all missions summary
router.get('/', (req, res) => {
    try {
        const missions = db.getAllMissions();
        res.json({ success: true, missions });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/checkpoints/:missionId — all scenes for one mission
router.get('/:missionId', (req, res) => {
    try {
        const scenes = db.getSceneCheckpoints(req.params.missionId);
        res.json({ success: true, scenes });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE /api/checkpoints/:missionId — delete entire mission (DB + disk files)
router.delete('/:missionId', (req, res) => {
    try {
        const scenes = db.getSceneCheckpoints(req.params.missionId);
        let filesDeleted = 0;
        for (const scene of scenes) {
            [scene.image_path, scene.video_path].forEach(p => {
                if (p && fs.existsSync(p)) {
                    try { fs.unlinkSync(p); filesDeleted++; } catch (_) {}
                }
            });
        }
        const rows = db.deleteMissionCheckpoints(req.params.missionId);
        res.json({ success: true, message: `Deleted ${rows} scene checkpoints and ${filesDeleted} files.` });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE /api/checkpoints/:missionId/scene/:index — delete single scene
router.delete('/:missionId/scene/:index', (req, res) => {
    try {
        const scene = db.getSceneCheckpoint(req.params.missionId, parseInt(req.params.index));
        let filesDeleted = 0;
        if (scene) {
            [scene.image_path, scene.video_path].forEach(p => {
                if (p && fs.existsSync(p)) {
                    try { fs.unlinkSync(p); filesDeleted++; } catch (_) {}
                }
            });
        }
        db.deleteSceneCheckpoint(req.params.missionId, parseInt(req.params.index));
        res.json({ success: true, message: `Scene ${req.params.index} deleted (${filesDeleted} files removed).` });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
