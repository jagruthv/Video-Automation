'use strict';
/**
 * AURA-V2: Library & Publishing Routes — /api/db/*, /api/library, /api/video/*
 * Manages video approval, rejection, streaming, and the publish queue.
 */
const express      = require('express');
const router       = express.Router();
const fs           = require('fs');
const db           = require('../modules/db');
const publishQueue = require('../modules/publish-queue');
const eventBus     = require('../modules/event-bus');

// GET /api/library — Full video library
router.get('/library', (req, res) => {
    try {
        const videos = db.getHistory();
        res.json({ videos, total: videos.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/library/import — Inject V3 rendered output seamlessly
router.post('/library/import', (req, res) => {
    try {
        const { title, description, file_path, thumbnail, metadata } = req.body;
        console.log(`[SYSTEM] 📥 Receiving external pipeline injection: ${title}`);
        
        // Use parameterized prepared statement — never interpolate user data into SQL
        db._raw().prepare(`
            INSERT INTO library 
            (title, description, file_path, video_url, thumbnail, affiliate_link, status, metadata, core_entity)
            VALUES (?, ?, ?, '', ?, '', 'pending_approval', ?, '')
        `).run(
            String(title || ''),
            String(description || ''),
            String(file_path || ''),
            String(thumbnail || ''),
            String(metadata || '{}')
        );
        
        res.json({ success: true, message: 'Registry injection successful.' });
    } catch (err) {
        console.error('[API] Injection Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/video/stream — Range-request video streaming
router.get('/video/stream', (req, res) => {
    try {
        const { id } = req.query;
        if (!id) return res.status(400).send('ID required');

        const video = db.getVideo(id);
        if (!video?.file_path)             return res.status(404).send('Video missing');
        if (!fs.existsSync(video.file_path)) return res.status(404).send('File not found on disk');

        const stat     = fs.statSync(video.file_path);
        const fileSize = stat.size;
        const range    = req.headers.range;

        if (range) {
            const parts     = range.replace(/bytes=/, '').split('-');
            const start     = parseInt(parts[0], 10);
            const end       = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = end - start + 1;
            res.writeHead(206, {
                'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges':  'bytes',
                'Content-Length': chunksize,
                'Content-Type':   'video/mp4',
            });
            fs.createReadStream(video.file_path, { start, end }).pipe(res);
        } else {
            res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
            fs.createReadStream(video.file_path).pipe(res);
        }
    } catch (err) {
        console.error('[STREAM ERROR]', err.message);
        res.status(500).send(err.message);
    }
});

// POST /api/db/approve — Approve video for publishing
router.post('/db/approve', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    db.updateStatus(id, 'approved');
    console.log(`[SYSTEM] ✅ Video ${id} approved. Enqueueing...`);
    publishQueue.enqueue(id);
    res.json({ message: 'Video queued for publishing.' });
});

// POST /api/db/reject — Reject a video
router.post('/db/reject', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    db.updateStatus(id, 'failed');
    console.log(`[SYSTEM] ❌ Video rejected: ID ${id}`);
    res.json({ message: 'Video rejected.' });
});

// POST /api/db/restore — Restore rejected video to pending
router.post('/db/restore', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    db.updateStatus(id, 'pending_approval');
    res.json({ success: true, message: 'Mission restored to Pending Approval.' });
});

// POST /api/db/update-path — Patch file_path for a library entry
router.post('/db/update-path', (req, res) => {
    const { id, file_path } = req.body;
    if (!id || !file_path) return res.status(400).json({ error: 'id and file_path required' });
    try {
        const result = db.updateFilePath(parseInt(id), file_path);
        console.log(`[SYSTEM] 📁 file_path patched for ID ${id} (changes: ${result.changes})`);
        res.json({ success: true, changes: result.changes });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/db/sync — Trigger recovery sync
router.post('/db/sync', (req, res) => {
    publishQueue.syncPublishQueue();
    res.json({ message: 'Recovery protocol triggered.' });
});

// GET /api/db/get-anchor — Get publish anchor timestamp
router.get('/db/get-anchor', (req, res) => {
    try {
        const dbAnchor = db.getAnchor();
        if (dbAnchor !== null) publishQueue.setAnchor(dbAnchor);
        res.json({ anchor: publishQueue.getAnchor() || null });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/db/set-anchor — Override publish anchor
router.post('/db/set-anchor', (req, res) => {
    try {
        const { timestamp } = req.body;
        publishQueue.setAnchor(timestamp ? Number(timestamp) : 0);
        const friendly = publishQueue.getAnchor() > 0
            ? new Date(publishQueue.getAnchor()).toLocaleString()
            : 'Auto-Detect (Disabled)';
        const msg = `[GHOST] ⚓ Anchor overridden to: ${friendly}`;
        console.log(msg);
        eventBus.emit('log', msg);
        res.json({ success: true, anchor: publishQueue.getAnchor(), message: msg });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
