'use strict';
/**
 * AURA-V2: Health & System Status — /api/health
 */
const express      = require('express');
const router       = express.Router();
const db           = require('../modules/db');
const publishQueue = require('../modules/publish-queue');
const { version }  = require('../../package.json');

router.get('/', async (req, res) => {
    let ytStatus = 'offline';
    const { google } = require('googleapis');
    const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;

    if (YT_CLIENT_ID && YT_CLIENT_SECRET && YT_REFRESH_TOKEN) {
        try {
            const auth = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
            auth.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
            await google.youtube({ version: 'v3', auth }).channels.list({ part: 'id', mine: true });
            ytStatus = 'connected';
        } catch {
            ytStatus = 'auth_error';
        }
    }

    res.json({
        status:      'ok',
        version,
        uptime:      process.uptime(),
        database:    db.getStatus(),
        youtube:     ytStatus,
        queue:       { length: publishQueue.getQueueLength(), publishing: publishQueue.getIsPublishing() },
        anchor:      publishQueue.getAnchor() || null,
        lastChecked: new Date().toISOString(),
    });
});

module.exports = router;
