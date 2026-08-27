'use strict';
/**
 * AURA-V2: SSE Event Stream — /api/logs
 * Server-Sent Events bridge for real-time orchestrator telemetry to frontend.
 */
const express  = require('express');
const router   = express.Router();
const eventBus = require('../modules/event-bus');

// GET /api/logs — SSE stream
router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Handshake
    res.write(`data: ${JSON.stringify({ type: 'sys', message: 'Connected to AURA-V2 Telemetry Engine' })}\n\n`);

    const logListener   = msg   => res.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
    const phaseListener = phase => res.write(`data: ${JSON.stringify({ type: 'phase', phase })}\n\n`);

    eventBus.on('log',   logListener);
    eventBus.on('phase', phaseListener);

    req.on('close', () => {
        eventBus.off('log',   logListener);
        eventBus.off('phase', phaseListener);
    });
});

module.exports = router;
