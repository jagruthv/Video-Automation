'use strict';
/**
 * AURA-V2 Publish Queue
 * Manages sequential scheduling of approved videos to YouTube.
 * Extracted from server.js to allow shared access from routes without circular deps.
 */
const db = require('./db');
const eventBus = require('./event-bus');

let publishQueue = [];
let isPublishing  = false;
let globalPublishAnchor = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

function getMsUntilPSTMidnight() {
    const pstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const next = new Date(pstDate);
    next.setHours(24, 1, 0, 0); // 12:01 AM PST
    return Math.max(60000, next.getTime() - pstDate.getTime());
}

function getHighestScheduledTime() {
    if (globalPublishAnchor > 0) return Number(globalPublishAnchor);
    let highest = 0;
    for (const v of db.getHistory()) {
        if (['published', 'approved', 'pending_approval', 'processing'].includes(v.status)) {
            try {
                const m = JSON.parse(v.metadata || '{}');
                if (m.scheduled_for) {
                    const parsed = Number(m.scheduled_for);
                    if (!isNaN(parsed) && parsed > highest) highest = parsed;
                }
            } catch {}
        }
    }
    return highest;
}

// ── Core Queue Processor ────────────────────────────────────────────────────

async function processPublishQueue() {
    if (isPublishing || publishQueue.length === 0) return;
    isPublishing = true;

    eventBus.emit('phase', 'publish');
    eventBus.emit('log', `[GHOST] 🛰️ Ignition sequence started... ${publishQueue.length} missions in pipeline.`);

    while (publishQueue.length > 0) {
        const id = publishQueue.shift();
        try {
            const video = db.getVideo(id);
            if (!video || !video.file_path) throw new Error('Video file_path missing in DB');

            const FOUR_HOURS = 4 * 60 * 60 * 1000;
            const now = Date.now();
            const highestScheduled = getHighestScheduledTime();
            const targetTimestamp = highestScheduled > 0 ? Math.max(now, highestScheduled + FOUR_HOURS) : now;

            // Persist anchor so next iteration builds on this slot
            globalPublishAnchor = targetTimestamp;
            db.setAnchor(globalPublishAnchor);
            db.updateMetadata(id, { scheduled_for: targetTimestamp });

            const targetDate  = new Date(targetTimestamp);
            const isImmediate = (targetTimestamp - now) < 15 * 60 * 1000;

            const logMsg = `[GHOST] ⚙️ Processing Queue ID ${id}. Target: ${targetDate.toLocaleString()}`;
            console.log(logMsg);
            eventBus.emit('log', logMsg);

            const publisher = require('./publisher');
            await publisher.publish(video.file_path, video, targetDate, isImmediate);

            db.updateStatus(id, 'published');
            const ok = `[GHOST] 🚀 Upload complete. Video ID ${id} is live/scheduled!`;
            console.log(ok);
            eventBus.emit('log', ok);
        } catch (err) {
            const isQuota = err.message && (err.message.includes('403') || err.message.toLowerCase().includes('quota'));
            if (isQuota) {
                const waitMs   = getMsUntilPSTMidnight();
                const waitHrs  = (waitMs / 3_600_000).toFixed(2);
                const msg1 = `[GHOST] 🛑 Quota Exhausted (403). Halting. ID ${id} stays Approved.`;
                const msg2 = `[GHOST] 🌙 Sleeping ${waitHrs}h until midnight PST quota reset.`;
                console.error(msg1); console.log(msg2);
                eventBus.emit('log', msg1); eventBus.emit('log', msg2);
                db.updateStatus(id, 'approved');
                publishQueue.length = 0;
                setTimeout(() => {
                    console.log(`[GHOST] ☀️ Quota Reset! Waking Publisher Daemon...`);
                    eventBus.emit('log', `[GHOST] ☀️ Quota Reset! Waking Publisher Daemon...`);
                    syncPublishQueue();
                }, waitMs);
                break;
            }
            const errMsg = `[GHOST] ❌ Upload failed for ID ${id}: ${err.message}`;
            console.error(errMsg);
            eventBus.emit('log', errMsg);
            db.updateStatus(id, 'error');
        }
    }

    isPublishing = false;
    eventBus.emit('log', `[GHOST] ⏸️ Publish queue exhausted. Ready for next cycle.`);
    console.log(`[SYSTEM] ⏸️ Publish queue exhausted.`);
}

// ── Recovery ─────────────────────────────────────────────────────────────────

function syncPublishQueue() {
    try {
        const approved = db.getHistory().filter(v => v.status === 'approved');
        const toEnqueue = approved.filter(v => !publishQueue.includes(v.id));
        if (toEnqueue.length > 0) {
            const msg = `[GHOST] 🛰️ Recovery: Enqueueing ${toEnqueue.length} approved missions...`;
            console.log(msg);
            eventBus.emit('log', msg);
            toEnqueue.forEach(v => publishQueue.push(v.id));
            processPublishQueue();
        }
    } catch (err) {
        console.error(`[SYSTEM] ❌ Recovery Failed: ${err.message}`);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

function enqueue(id) {
    publishQueue.push(id);
    processPublishQueue();
}

function getAnchor()          { return globalPublishAnchor; }
function setAnchor(ts)        { globalPublishAnchor = Number(ts) || 0; db.setAnchor(globalPublishAnchor); }
function getQueueLength()     { return publishQueue.length; }
function getIsPublishing()    { return isPublishing; }

module.exports = { enqueue, syncPublishQueue, getAnchor, setAnchor, getQueueLength, getIsPublishing };
