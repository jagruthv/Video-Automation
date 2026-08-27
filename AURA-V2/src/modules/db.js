const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../tmp/database.sqlite');
const FALLBACK_PATH = path.join(__dirname, '../../tmp/library_backup.json');

// Ensure tmp directory exists
const tmpDir = path.dirname(DB_PATH);
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

let db;
let isFailsafe = false;

/**
 * FAILSAFE PERSISTENCE LAYER (JSON-FILE)
 * Ensures zero data loss even if the native SQLite driver is missing.
 */
const JSON_DB = {
    load: () => {
        if (!fs.existsSync(FALLBACK_PATH)) return [];
        try {
            return JSON.parse(fs.readFileSync(FALLBACK_PATH, 'utf8'));
        } catch (e) {
            return [];
        }
    },
    save: (data) => {
        fs.writeFileSync(FALLBACK_PATH, JSON.stringify(data, null, 2));
    }
};

try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    console.log(`[DATABASE] 🗄️ SQLite Engine: Native (High Performance)`);
    
    // Initialize the schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS library (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        description TEXT,
        file_path TEXT,
        video_url TEXT,
        thumbnail TEXT,
        affiliate_link TEXT,
        status TEXT DEFAULT 'pending_approval',
        metadata TEXT,
        core_entity TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS view_snapshots (
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        views INTEGER
      );
      CREATE TABLE IF NOT EXISTS scraped_urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE,
        analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS production_queue (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT NOT NULL,
        topic        TEXT,
        context      TEXT,
        affiliate    TEXT,
        template     TEXT    DEFAULT 'STANDARD',
        target_stage TEXT    DEFAULT 'complete',
        status       TEXT    DEFAULT 'pending',
        stage_reached TEXT,
        path_script  TEXT,
        path_images  TEXT,
        path_audio   TEXT,
        path_video   TEXT,
        path_final   TEXT,
        error        TEXT,
        error_stage  TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      );
      CREATE TABLE IF NOT EXISTS scene_checkpoints (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id   TEXT NOT NULL,
        scene_index  INTEGER NOT NULL,
        image_path   TEXT,
        video_path   TEXT,
        provider     TEXT,
        image_status TEXT DEFAULT 'pending',
        video_status TEXT DEFAULT 'pending',
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(mission_id, scene_index)
      );
      CREATE TABLE IF NOT EXISTS warehouse_blueprints (
        id               TEXT PRIMARY KEY,
        title            TEXT NOT NULL,
        topic            TEXT,
        template         TEXT DEFAULT 'STANDARD',
        bg_mode          TEXT DEFAULT 'pinterest',
        blueprint_json   TEXT NOT NULL,
        stage            TEXT DEFAULT 'scripted',
        status           TEXT DEFAULT 'warehoused',
        audio_path       TEXT,
        images_json      TEXT,
        video_clips_json TEXT,
        failure_stage    TEXT,
        failure_reason   TEXT,
        logs             TEXT,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    try { db.exec("ALTER TABLE library ADD COLUMN core_entity TEXT;"); } catch (e) {}
    // Migrate warehouse table for existing databases
    const warehouseMigrations = ['audio_path TEXT', 'images_json TEXT', 'video_clips_json TEXT', 'failure_stage TEXT', 'failure_reason TEXT'];
    for (const col of warehouseMigrations) {
        try { db.exec(`ALTER TABLE warehouse_blueprints ADD COLUMN ${col};`); } catch(e) {}
    }
} catch (err) {
    // Native binding failed (Node version mismatch). Use sql.js which reads the real .sqlite file.
    console.warn(`[DATABASE] ⚠️ Native binding unavailable. Loading sql.js (full data preserved)...`);
    
    // sql.js is async — load synchronously via a blocking init pattern
    const initSqlJs = require('sql.js');
    let sqlDb = null;
    
    // We use a module-level init that will be ready by the time routes use db
    const _initPromise = initSqlJs().then(SQL => {
        const fileBuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
        sqlDb = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

        // Ensure schema
        sqlDb.run(`CREATE TABLE IF NOT EXISTS library (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT,
            file_path TEXT, video_url TEXT, thumbnail TEXT, affiliate_link TEXT,
            status TEXT DEFAULT 'pending_approval', metadata TEXT, core_entity TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );`);
        sqlDb.run(`CREATE TABLE IF NOT EXISTS view_snapshots (timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, views INTEGER);`);
        sqlDb.run(`CREATE TABLE IF NOT EXISTS scraped_urls (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT UNIQUE, analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
        sqlDb.run(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);`);
        sqlDb.run(`CREATE TABLE IF NOT EXISTS production_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL, topic TEXT, context TEXT, affiliate TEXT,
          template TEXT DEFAULT 'STANDARD', target_stage TEXT DEFAULT 'complete',
          status TEXT DEFAULT 'pending', stage_reached TEXT,
          path_script TEXT, path_images TEXT, path_audio TEXT, path_video TEXT, path_final TEXT,
          error TEXT, error_stage TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME
        );`);
        sqlDb.run(`CREATE TABLE IF NOT EXISTS scene_checkpoints (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mission_id TEXT NOT NULL, scene_index INTEGER NOT NULL,
          image_path TEXT, video_path TEXT, provider TEXT,
          image_status TEXT DEFAULT 'pending', video_status TEXT DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(mission_id, scene_index)
        );`);
        sqlDb.run(`CREATE TABLE IF NOT EXISTS warehouse_blueprints (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT, template TEXT DEFAULT 'STANDARD',
          bg_mode TEXT DEFAULT 'pinterest', blueprint_json TEXT NOT NULL, stage TEXT DEFAULT 'scripted',
          status TEXT DEFAULT 'warehoused', audio_path TEXT, images_json TEXT, video_clips_json TEXT,
          failure_stage TEXT, failure_reason TEXT, logs TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );`);
        try { sqlDb.run("ALTER TABLE library ADD COLUMN core_entity TEXT;"); } catch(e) {}
        
        // Migrate warehouse table for existing databases running on sql.js
        const warehouseMigrations = ['audio_path TEXT', 'images_json TEXT', 'video_clips_json TEXT', 'failure_stage TEXT', 'failure_reason TEXT'];
        for (const col of warehouseMigrations) {
            try { sqlDb.run(`ALTER TABLE warehouse_blueprints ADD COLUMN ${col};`); } catch(e) {}
        }

        const persist = () => fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export()));

        // Wrap sql.js to match better-sqlite3 synchronous interface
        db = {
            prepare: (sql) => ({
                all: (...params) => {
                    const stmt = sqlDb.prepare(sql);
                    if (params.length) stmt.bind(params);
                    const rows = [];
                    while (stmt.step()) rows.push(stmt.getAsObject());
                    stmt.free();
                    return rows;
                },
                get: (...params) => {
                    const stmt = sqlDb.prepare(sql);
                    if (params.length) stmt.bind(params);
                    const row = stmt.step() ? stmt.getAsObject() : undefined;
                    stmt.free();
                    return row;
                },
                run: (...params) => {
                    sqlDb.run(sql, params);
                    const ch = sqlDb.exec('SELECT changes()');
                    const lid = sqlDb.exec('SELECT last_insert_rowid()');
                    persist();
                    return {
                        changes: ch[0]?.values[0][0] || 0,
                        lastInsertRowid: lid[0]?.values[0][0] || 0
                    };
                }
            }),
            exec: (sql) => { sqlDb.run(sql); persist(); }
        };

        const count = sqlDb.exec('SELECT COUNT(*) FROM library');
        const recovered = count[0]?.values[0][0] || 0;
        console.log(`[DATABASE] ✅ sql.js Engine Active: ${recovered} missions recovered from database.sqlite`);
    }).catch(e => {
        console.error(`[DATABASE] 💀 sql.js failed: ${e.message}. Using JSON fallback.`);
        isFailsafe = true;
        if (!fs.existsSync(FALLBACK_PATH)) JSON_DB.save({ library: [], snapshots: [] });
    });

    // Keep a local reference, we will export it below
    var localDbReady = _initPromise;
}

/**
 * AURA-V2 Local Database Controller
 * Optimized for dual-mode operation (SQLite or JSON).
 */
module.exports = {
    _dbReady: typeof localDbReady !== 'undefined' ? localDbReady : Promise.resolve(),
    _raw: () => db, // Direct access to the db object for queue CRUD
    getStatus: () => isFailsafe ? 'failsafe_json' : 'native_sqlite',

    getAnchor: () => {
        if (!isFailsafe) {
            const row = db.prepare("SELECT value FROM config WHERE key = 'anchor'").get();
            return row ? parseInt(row.value, 10) : null;
        } else {
            const data = JSON_DB.load();
            return data.anchor || null;
        }
    },

    setAnchor: (timestamp) => {
        if (!isFailsafe) {
            const stmt = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('anchor', ?)");
            stmt.run(timestamp.toString());
        } else {
            const data = JSON_DB.load();
            data.anchor = timestamp;
            JSON_DB.save(data);
        }
    },

    /**
     * AURA-Watcher: Zero-Lag Telemetry Persistence
     */
    saveSnapshot: (views) => {
        if (!isFailsafe) {
            const stmt = db.prepare("INSERT INTO view_snapshots (views) VALUES (?)");
            return stmt.run(views);
        } else {
            const data = JSON_DB.load();
            if (!data.snapshots) data.snapshots = [];
            data.snapshots.push({ timestamp: new Date().toISOString(), views });
            // Prune snapshots older than 48h to keep JSON small
            const limit = Date.now() - (48 * 60 * 60 * 1000);
            data.snapshots = data.snapshots.filter(s => new Date(s.timestamp).getTime() > limit);
            JSON_DB.save(data);
        }
    },

    getViewSnapshots: (hours = 24) => {
        if (!isFailsafe) {
            const stmt = db.prepare(`
                SELECT timestamp, views 
                FROM view_snapshots 
                WHERE timestamp >= datetime('now', ?)
                ORDER BY timestamp ASC
            `);
            return stmt.all(`-${hours} hours`);
        } else {
            const data = JSON_DB.load();
            if (!data.snapshots) return [];
            const limit = Date.now() - (hours * 60 * 60 * 1000);
            return data.snapshots.filter(s => new Date(s.timestamp).getTime() > limit);
        }
    },

    /**
     * Add a new video record to the library
     */
    addVideo: (video) => {
        if (!isFailsafe) {
            const stmt = db.prepare(`
                INSERT INTO library (title, description, file_path, video_url, thumbnail, affiliate_link, status, metadata, core_entity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            return stmt.run(
                video.title,
                video.description,
                video.file_path || '',
                video.video_url || '',
                video.thumbnail || '',
                video.affiliate_link || '',
                video.status || 'pending_approval',
                JSON.stringify(video.metadata || {}),
                video.core_entity || ''
            );
        } else {
            const data = JSON_DB.load();
            if (!data.library) data.library = [];
            const newRecord = {
                id: Date.now(),
                ...video,
                created_at: new Date().toISOString()
            };
            data.library.push(newRecord);
            JSON_DB.save(data);
            return { changes: 1, lastInsertRowid: newRecord.id };
        }
    },

    /**
     * Get all videos for the database view
     */
    getHistory: (status = null) => {
        if (!isFailsafe) {
            if (status) {
                return db.prepare('SELECT * FROM library WHERE status = ? ORDER BY created_at DESC').all(status);
            }
            return db.prepare('SELECT * FROM library ORDER BY created_at DESC').all();
        } else {
            const data = JSON_DB.load();
            const library = data.library || [];
            const sorted = library.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            if (status) return sorted.filter(v => v.status === status);
            return sorted;
        }
    },

    /**
     * Fetch a single video by ID
     */
    getVideo: (id) => {
        if (!isFailsafe) {
            return db.prepare('SELECT * FROM library WHERE id = ?').get(id);
        } else {
            const data = JSON_DB.load();
            const library = data.library || [];
            return library.find(v => v.id == id);
        }
    },

    /**
     * Update the status of a video
     */
    updateStatus: (id, status) => {
        if (!isFailsafe) {
            const stmt = db.prepare('UPDATE library SET status = ? WHERE id = ?');
            return stmt.run(status, id);
        } else {
            const data = JSON_DB.load();
            const library = data.library || [];
            const record = library.find(v => v.id == id);
            if (record) {
                record.status = status;
                JSON_DB.save(data);
            }
            return { changes: record ? 1 : 0 };
        }
    },

    /**
     * Update the metadata JSON of a video
     */
    updateMetadata: (id, metaObject) => {
        const current = db.prepare('SELECT metadata FROM library WHERE id = ?').get(id);
        if (!current) return;
        let existing = {};
        try { existing = JSON.parse(current.metadata || '{}'); } catch(e){}
        
        const merged = { ...existing, ...metaObject };
        
        if (!isFailsafe) {
            const stmt = db.prepare('UPDATE library SET metadata = ? WHERE id = ?');
            return stmt.run(JSON.stringify(merged), id);
        } else {
            const data = JSON_DB.load();
            const library = data.library || [];
            const record = library.find(v => v.id == id);
            if (record) {
                record.metadata = JSON.stringify(merged);
                JSON_DB.save(data);
            }
            return { changes: record ? 1 : 0 };
        }
    },

    /**
     * Delete a record or video
     */
    deleteVideo: (id) => {
        if (!isFailsafe) {
            const stmt = db.prepare('DELETE FROM library WHERE id = ?');
            return stmt.run(id);
        } else {
            const data = JSON_DB.load();
            const library = data.library || [];
            const filtered = library.filter(v => v.id != id);
            data.library = filtered;
            JSON_DB.save(data);
            return { changes: library.length - filtered.length };
        }
    },

    updateFilePath: (id, filePath) => {
        if (!isFailsafe) {
            return db.prepare('UPDATE library SET file_path = ? WHERE id = ?').run(filePath, id);
        } else {
            const data = JSON_DB.load();
            const record = (data.library || []).find(v => v.id == id);
            if (record) { record.file_path = filePath; JSON_DB.save(data); }
            return { changes: record ? 1 : 0 };
        }
    },

    /**
     * Get count of times a core entity has been generated (2-Strike Rule)
     */
    getCoreEntityCount: (entityText) => {
        if (!entityText) return 0;
        if (!isFailsafe) {
            const result = db.prepare('SELECT COUNT(*) as count FROM library WHERE core_entity = ? COLLATE NOCASE').get(entityText);
            return result ? result.count : 0;
        } else {
            const data = JSON_DB.load();
            const library = data.library || [];
            return library.filter(v => (v.core_entity || '').toLowerCase() === entityText.toLowerCase()).length;
        }
    },
    
    /**
     * Add URL to Scraped URLs list
     */
    addScrapedUrl: (url) => {
        if (!isFailsafe && url) {
            try {
                db.prepare('INSERT INTO scraped_urls (url) VALUES (?)').run(url);
                return true;
            } catch (e) { return false; } // likely UNIQUE constraint failure
        }
        return false;
    },
    
    /**
     * Fix stuck rendering tasks at startup
     */
    recoverStuckMissions: () => {
        if (!isFailsafe) {
            const stmt = db.prepare("UPDATE library SET status = 'failed_interrupted' WHERE status = 'rendering' OR status = 'queue'");
            const result = stmt.run();
            if (result.changes > 0) {
                console.log(`[DATABASE] 🔄 Recovery Protocol: Freed ${result.changes} stranded missions.`);
            }
        }
    },

    /**
     * CRASH RECOVERY: Any warehouse entry stuck in 'rendering' means the process
     * was killed mid-run (CMD closed, crash, etc.).
     * Reset them to 'warehoused' so they appear as resumable in the Warehouse UI.
     * This is called automatically on every server startup.
     */
    resetCrashedWarehouseEntries: () => {
        if (isFailsafe) return 0;
        try {
            const result = db.prepare(
                `UPDATE warehouse_blueprints SET status = 'warehoused'
                 WHERE status = 'rendering'`
            ).run();
            if (result.changes > 0) {
                console.log(`[DATABASE] 🛟 Crash Recovery: ${result.changes} warehouse entry(s) rescued from 'rendering' → now resumable.`);
            }
            return result.changes;
        } catch (e) {
            console.warn(`[DATABASE] ⚠️ resetCrashedWarehouseEntries failed: ${e.message}`);
            return 0;
        }
    },

    // ─── Scene Checkpoint CRUD ───────────────────────────────────────────────

    /**
     * Upsert a checkpoint for one scene (called after image or video completes)
     */
    upsertSceneCheckpoint: (missionId, sceneIndex, data = {}) => {
        if (isFailsafe) return;
        try {
            db.prepare(`
                INSERT INTO scene_checkpoints (mission_id, scene_index, image_path, video_path, provider, image_status, video_status, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(mission_id, scene_index) DO UPDATE SET
                  image_path   = COALESCE(excluded.image_path, image_path),
                  video_path   = COALESCE(excluded.video_path, video_path),
                  provider     = COALESCE(excluded.provider, provider),
                  image_status = COALESCE(excluded.image_status, image_status),
                  video_status = COALESCE(excluded.video_status, video_status),
                  updated_at   = CURRENT_TIMESTAMP
            `).run(
                missionId,
                sceneIndex,
                data.image_path || null,
                data.video_path || null,
                data.provider || null,
                data.image_status || null,
                data.video_status || null
            );
        } catch (e) {
            console.warn(`[DB] ⚠️ Checkpoint upsert failed for scene ${sceneIndex}: ${e.message}`);
        }
    },

    /**
     * Get all scene checkpoints for a mission
     */
    getSceneCheckpoints: (missionId) => {
        if (isFailsafe) return [];
        try {
            return db.prepare('SELECT * FROM scene_checkpoints WHERE mission_id = ? ORDER BY scene_index ASC').all(missionId);
        } catch (e) { return []; }
    },

    /**
     * Get one checkpoint for a specific scene
     */
    getSceneCheckpoint: (missionId, sceneIndex) => {
        if (isFailsafe) return null;
        try {
            return db.prepare('SELECT * FROM scene_checkpoints WHERE mission_id = ? AND scene_index = ?').get(missionId, sceneIndex);
        } catch (e) { return null; }
    },

    /**
     * List all missions that have checkpoints (for the Studio viewer)
     */
    getAllMissions: () => {
        if (isFailsafe) return [];
        try {
            return db.prepare(`
                SELECT mission_id,
                       COUNT(*) AS total_scenes,
                       SUM(CASE WHEN image_status = 'done' THEN 1 ELSE 0 END) AS images_done,
                       SUM(CASE WHEN video_status = 'done' THEN 1 ELSE 0 END) AS videos_done,
                       MIN(created_at) AS started_at,
                       MAX(updated_at) AS last_updated
                FROM scene_checkpoints
                GROUP BY mission_id
                ORDER BY started_at DESC
            `).all();
        } catch (e) { return []; }
    },

    /**
     * Delete all checkpoints for a mission (does NOT delete files from disk)
     */
    deleteMissionCheckpoints: (missionId) => {
        if (isFailsafe) return 0;
        try {
            return db.prepare('DELETE FROM scene_checkpoints WHERE mission_id = ?').run(missionId).changes;
        } catch (e) { return 0; }
    },

    deleteSceneCheckpoint: (missionId, sceneIndex) => {
        if (isFailsafe) return 0;
        try {
            return db.prepare('DELETE FROM scene_checkpoints WHERE mission_id = ? AND scene_index = ?').run(missionId, sceneIndex).changes;
        } catch (e) { return 0; }
    },

    // ─── Warehouse Blueprints CRUD ──────────────────────────────────────────

    addWarehouseBlueprint: (blueprintId, draft) => {
        if (isFailsafe) return;
        try {
            const stmt = db.prepare(`
                INSERT INTO warehouse_blueprints
                  (id, title, topic, template, bg_mode, blueprint_json, stage, status, audio_path, images_json, video_clips_json, logs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(
                blueprintId,
                draft.title || 'Untitled',
                draft.topic || '',
                draft.template || 'STANDARD',
                draft.bg_mode !== undefined ? draft.bg_mode : null, // null is valid for STANDARD template
                JSON.stringify(draft.blueprint),
                draft.stage || 'scripted',
                draft.status || 'warehoused',
                draft.audio_path || null,
                draft.images_json ? JSON.stringify(draft.images_json) : null,
                draft.video_clips_json ? JSON.stringify(draft.video_clips_json) : null,
                draft.logs || ''
            );
        } catch (e) {
            console.error(`[DB] ❌ Failed to warehouse blueprint: ${e.message}`);
        }
    },

    getWarehouseBlueprints: () => {
        if (isFailsafe) return [];
        try {
            return db.prepare(`SELECT * FROM warehouse_blueprints ORDER BY created_at DESC`).all().map(row => {
                try { row.blueprint_json = JSON.parse(row.blueprint_json); } catch(e){}
                return row;
            });
        } catch (e) { return []; }
    },

    getWarehouseBlueprintById: (id) => {
        if (isFailsafe) return null;
        try {
            const row = db.prepare(`SELECT * FROM warehouse_blueprints WHERE id = ?`).get(id);
            if (row) {
                try { row.blueprint_json = JSON.parse(row.blueprint_json); } catch(e){}
            }
            return row;
        } catch (e) { return null; }
    },

    updateWarehouseBlueprintStage: (id, stage, status = 'warehoused', logEntry = '', assetPatch = {}) => {
        if (isFailsafe) return;
        try {
            // Build dynamic SET clause based on what assets are being updated
            const sets = [`stage = ?`, `status = ?`, `logs = COALESCE(logs, '') || CHAR(10) || ?`];
            const vals = [stage, status, logEntry];
            if (assetPatch.audio_path !== undefined)       { sets.push(`audio_path = ?`);       vals.push(assetPatch.audio_path); }
            if (assetPatch.images_json !== undefined)      { sets.push(`images_json = ?`);      vals.push(JSON.stringify(assetPatch.images_json)); }
            if (assetPatch.video_clips_json !== undefined) { sets.push(`video_clips_json = ?`); vals.push(JSON.stringify(assetPatch.video_clips_json)); }
            if (assetPatch.failure_stage !== undefined)    { sets.push(`failure_stage = ?`);    vals.push(assetPatch.failure_stage); }
            if (assetPatch.failure_reason !== undefined)   { sets.push(`failure_reason = ?`);   vals.push(assetPatch.failure_reason); }
            vals.push(id);
            db.prepare(`UPDATE warehouse_blueprints SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        } catch(e) { console.warn(`[DB] warehouse stage update failed: ${e.message}`); }
    },

    deleteWarehouseBlueprint: (id) => {
        if (isFailsafe) return 0;
        try {
            return db.prepare(`DELETE FROM warehouse_blueprints WHERE id = ?`).run(id).changes;
        } catch (e) { return 0; }
    },

    getRecentTopics: (days = 90) => {
        if (isFailsafe) return [];
        try {
            const wTopics = db.prepare(`SELECT title FROM warehouse_blueprints WHERE created_at >= date('now', '-${days} days') LIMIT 100`).all().map(r => r.title);
            const lTopics = db.prepare(`SELECT core_entity FROM library WHERE created_at >= date('now', '-${days} days') LIMIT 100`).all().map(r => r.core_entity).filter(Boolean);
            return [...new Set([...wTopics, ...lTopics])];
        } catch(e) { return []; }
    },

    /**
     * Get resumable warehouse drafts for a given bg_mode, ordered by most progress made (deepest stage first).
     * Excludes drafts currently rendering or already completed.
     */
    getWarehouseResidues: (bgMode = null) => {
        if (isFailsafe) return [];
        try {
            const STAGE_ORDER = ['scripted','has_audio','has_images','has_video_clips','renderable','error'];
            const rows = bgMode
                ? db.prepare(`SELECT * FROM warehouse_blueprints WHERE bg_mode = ? AND status NOT IN ('rendering') ORDER BY created_at ASC`).all(bgMode)
                : db.prepare(`SELECT * FROM warehouse_blueprints WHERE status NOT IN ('rendering') ORDER BY created_at ASC`).all();

            return rows.map(row => {
                try { row.blueprint_json   = JSON.parse(row.blueprint_json);   } catch(e){}
                try { row.images_json      = JSON.parse(row.images_json);      } catch(e){}
                try { row.video_clips_json = JSON.parse(row.video_clips_json); } catch(e){}
                return row;
            }).sort((a, b) => STAGE_ORDER.indexOf(b.stage) - STAGE_ORDER.indexOf(a.stage)); // deepest stage first
        } catch(e) { return []; }
    }
};
