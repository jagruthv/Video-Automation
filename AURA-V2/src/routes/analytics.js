'use strict';
/**
 * AURA-V2: Analytics Routes — /api/analytics
 * YouTube + AdSense stats with local snapshot fallback.
 */
const express = require('express');
const router  = express.Router();
const db      = require('../modules/db');

router.get('/', async (req, res) => {
    const { google } = require('googleapis');
    const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
    const range = req.query.range || '6h';

    if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
        return res.json({ total_views: '---', total_subscribers: '---', estimated_earnings: 'Pending Auth', status: 'offline' });
    }

    const oAuth = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
    oAuth.setCredentials({ refresh_token: YT_REFRESH_TOKEN });

    try {
        const youtube   = google.youtube({ version: 'v3', auth: oAuth });
        const adsense   = google.adsense({ version: 'v2', auth: oAuth });
        const analytics = google.youtubeAnalytics({ version: 'v2', auth: oAuth });

        const rangeMap = {
            '1h': { days: 1, points: 12, label: '5m' },
            '1d': { days: 1, points: 24, label: 'h' },
            '7d': { days: 7, points: 7,  label: 'd' },
            '1m': { days: 30, points: 30, label: 'd' },
            '6m': { days: 180, points: 6, label: 'mo' },
        };
        const cfg = rangeMap[range] || rangeMap['1d'];

        // ── Earnings ────────────────────────────────────────────────────────
        let auditedEarnings = '$0.00';
        let dataSource      = 'Syncing with AdSense Service...';
        let isAudited       = false;
        try {
            const accts = await adsense.accounts.list();
            if (accts.data.accounts?.length > 0) {
                const accountId = accts.data.accounts[0].name;
                const report    = await adsense.accounts.reports.generate({
                    account: accountId, dateRange: 'TODAY', metrics: ['TOTAL_EARNINGS']
                });
                if (report.data.rows?.length > 0) {
                    auditedEarnings = `$${Number(report.data.rows[0].cells[0].value).toFixed(2)}`;
                    dataSource = 'AUDITED: AdSense Management API';
                    isAudited = true;
                }
            }
        } catch (e) {
            console.debug(`[ADSENSE] Scope unavailable: ${e.message}`);
        }

        // ── View Velocity ────────────────────────────────────────────────────
        let velocity = [];
        if (['1h', '1d'].includes(range)) {
            const snaps = db.getViewSnapshots(range === '1h' ? 1 : 24);
            if (snaps.length > 1) {
                for (let i = 1; i < snaps.length; i++) {
                    velocity.push({
                        name: new Date(snaps[i].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        value: Math.max(0, snaps[i].views - snaps[i-1].views),
                    });
                }
            }
        }
        if (velocity.length === 0) {
            try {
                const today = new Date().toISOString().split('T')[0];
                const start = new Date(Date.now() - cfg.days * 86_400_000).toISOString().split('T')[0];
                const rep   = await analytics.reports.query({ ids: 'channel==MINE', startDate: start, endDate: today, metrics: 'views', dimensions: 'day' });
                if (rep.data.rows?.length > 0) velocity = rep.data.rows.map(r => ({ name: r[0], value: Number(r[1]) }));
            } catch (e) {
                console.warn(`[ANALYTICS] ⚠️ API stalled: ${e.message}`);
            }
        }
        if (velocity.length === 0) {
            velocity = Array.from({ length: cfg.points }, (_, i) => ({ name: `${i}`, value: 0 }));
        }

        // ── Recent Activity ──────────────────────────────────────────────────
        let recentActivity = [];
        try {
            const ch      = await youtube.channels.list({ part: 'contentDetails', mine: true });
            const listId  = ch.data.items[0].contentDetails.relatedPlaylists.uploads;
            const uploads = await youtube.playlistItems.list({ playlistId: listId, part: 'snippet', maxResults: 5 });
            recentActivity = (uploads.data.items || []).map(item => ({
                id: item.id, title: item.snippet.title,
                timestamp: new Date(item.snippet.publishedAt).toLocaleDateString(),
                status: 'PUBLISHED', type: 'VIDEO',
            }));
        } catch (e) {
            console.warn(`[ACTIVITY] ⚠️ Sync stalled: ${e.message}`);
        }

        // ── Channel Stats ────────────────────────────────────────────────────
        const chanRes = await youtube.channels.list({ part: 'snippet,statistics', mine: true });
        if (chanRes.data.items?.length > 0) {
            const { snippet, statistics } = chanRes.data.items[0];
            const views = Number(statistics.viewCount);
            const missionStart = new Date('2026-03-01T00:00:00Z');
            const hrs = Math.max(1, (Date.now() - missionStart.getTime()) / 3_600_000);
            const viewsDelta = velocity.length > 0
                ? (velocity.reduce((s, p) => s + p.value, 0) > 0 ? `+${velocity.reduce((s, p) => s + p.value, 0)}` : 'STABLE')
                : 'SYNCED';

            return res.json({
                channel_name: snippet.title, channel_logo: snippet.thumbnails.high.url,
                total_views: views.toLocaleString(), total_subscribers: Number(statistics.subscriberCount).toLocaleString(),
                total_videos: Number(statistics.videoCount).toLocaleString(),
                estimated_earnings: auditedEarnings, revenue_source: dataSource,
                velocity, recent_activity: recentActivity,
                gen_velocity: `${(views / hrs).toFixed(1)} v/hr`,
                views_delta: viewsDelta, subs_delta: 'LIVE',
                range, status: 'live', audited: isAudited,
                reality_check: 'Zero-Lag Telemetry Active',
            });
        }
    } catch (err) {
        console.error(`[ANALYTICS] ❌ Sync Failed: ${err.message}`);
    }

    res.json({ total_views: 'Initializing...', total_subscribers: 'Initializing...', estimated_earnings: 'Syncing...', status: 'syncing' });
});

module.exports = router;
