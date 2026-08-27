'use strict';
/**
 * AURA-V2: Production Queue Manager
 * 
 * SQLite-backed queue for storing video briefs and managing checkpoint-aware
 * pipeline execution. All project assets stored on D: drive in workspace.
 */
const path = require('path');
const fs = require('fs');

const PROJECTS_DIR = path.join(__dirname, '../../data/projects');

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDir(PROJECTS_DIR);

/**
 * Get the standard path layout for a given queue item ID.
 */
function getProjectPaths(id) {
    const base = path.join(PROJECTS_DIR, String(id));
    return {
        base,
        script:  path.join(base, 'blueprint.json'),
        images:  path.join(base, 'images'),
        audio:   path.join(base, 'audio.mp3'),
        video:   path.join(base, 'videos'),
        final:   path.join(base, 'final.mp4'),
    };
}

let db;
function getDb() {
    if (!db) db = require('./db');
    return db;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function enqueue(brief) {
    const { title, topic, context, affiliate, template = 'STANDARD', target_stage = 'complete' } = brief;
    if (!title) throw new Error('Queue item must have a title');
    const d = getDb();
    const stmt = d._raw().prepare(
        `INSERT INTO production_queue (title, topic, context, affiliate, template, target_stage)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(title, topic || null, context || null, affiliate || null, template, target_stage);
    const id = result.lastInsertRowid;
    // Create project directory immediately to reserve space
    ensureDir(getProjectPaths(id).base);
    console.log(`[QUEUE] ✅ Brief saved — ID ${id}: "${title}" (target: ${target_stage})`);
    return id;
}

function getAll() {
    return getDb()._raw().prepare('SELECT * FROM production_queue ORDER BY created_at DESC').all();
}

function getById(id) {
    return getDb()._raw().prepare('SELECT * FROM production_queue WHERE id = ?').get(id);
}

function update(id, fields) {
    const setClause = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(fields), id];
    getDb()._raw().prepare(`UPDATE production_queue SET ${setClause} WHERE id = ?`).run(...values);
}

function remove(id) {
    // Clean up project directory
    const paths = getProjectPaths(id);
    if (fs.existsSync(paths.base)) {
        fs.rmSync(paths.base, { recursive: true, force: true });
        console.log(`[QUEUE] 🗑️ Project files deleted for ID ${id}`);
    }
    getDb()._raw().prepare('DELETE FROM production_queue WHERE id = ?').run(id);
    console.log(`[QUEUE] ✅ Queue item ${id} removed`);
}

// ── CHECKPOINT STATUS ─────────────────────────────────────────────────────────

/**
 * Returns which stages are already cached for a given item.
 * Checks actual file existence on disk.
 */
function getCheckpoints(id) {
    const paths = getProjectPaths(id);
    return {
        script: fs.existsSync(paths.script),
        images: fs.existsSync(paths.images) && fs.readdirSync(paths.images).length > 0,
        audio:  fs.existsSync(paths.audio),
        video:  fs.existsSync(paths.video) && fs.readdirSync(paths.video).length > 0,
        final:  fs.existsSync(paths.final),
    };
}

// ── RETRY LOGIC ───────────────────────────────────────────────────────────────

/**
 * Retry wrapper for API calls that may hit rate limits.
 * Strategy: fail → +5s wait → retry → +15s wait → retry → give up
 */
async function withRetry(fn, label) {
    const BASE_WAIT = 20000;
    const EXTRA_WAITS = [5000, 15000]; // +5s, then +15s on top of base

    for (let attempt = 0; attempt <= EXTRA_WAITS.length; attempt++) {
        try {
            return await fn();
        } catch (e) {
            const isRateLimit = e.message && (
                e.message.includes('429') ||
                e.message.includes('402') ||
                e.message.includes('rate') ||
                e.message.includes('quota') ||
                e.message.includes('limit')
            );

            if (attempt >= EXTRA_WAITS.length) {
                console.error(`[QUEUE] ❌ ${label} — All retries exhausted. Final error: ${e.message}`);
                throw e;
            }

            const extraWait = EXTRA_WAITS[attempt];
            const totalWait = BASE_WAIT + extraWait;
            if (isRateLimit) {
                console.warn(`[QUEUE] ⚠️ ${label} — Rate limit hit (attempt ${attempt + 1}). Waiting ${totalWait / 1000}s before retry...`);
            } else {
                console.warn(`[QUEUE] ⚠️ ${label} — Failed (attempt ${attempt + 1}): ${e.message}. Retrying after ${totalWait / 1000}s...`);
            }
            await new Promise(r => setTimeout(r, totalWait));
        }
    }
}

module.exports = {
    enqueue,
    getAll,
    getById,
    update,
    remove,
    getCheckpoints,
    getProjectPaths,
    withRetry,
};
