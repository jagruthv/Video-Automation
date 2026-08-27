const scriptWriter = require('./modules/script-writer');
const visualEngine = require('./modules/visual-engine');
const audioEngine = require('./modules/audio-engine');
const assemblyEngine = require('./modules/assembly-engine');
const musicEngine = require('./modules/music-engine');
const publisher = require('./modules/publisher');
const db = require('./modules/db');
const eventBus = require('./modules/event-bus');
const queueManager = require('./queue-manager');

// AURA TITANIUM: Global Console Telemetry Override
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    originalLog.apply(console, args);
    eventBus.emit('log', msg);
};

console.error = function(...args) {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    originalError.apply(console, args);
    eventBus.emit('log', `[ERROR] ${msg}`);
};

function emitPhase(phase) { eventBus.emit('phase', phase); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const INTER_STAGE_COOLDOWN = parseInt(process.env.STAGE_COOLDOWN_MS, 10) || 15000;

/**
 * Silent per-step warehouse checkpoint.
 * Never throws — a logging failure must never break the pipeline.
 */
function warehouseLog(activeWarehouseId, stage, status, message, assetPatch = {}) {
    if (!activeWarehouseId) return;
    try {
        const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
        db.updateWarehouseBlueprintStage(activeWarehouseId, stage, status, `[${ts}] ${message}`, assetPatch);
    } catch (e) {
        // Deliberately swallowed — logging must never crash the pipeline
    }
}

/**
 * AURA-V2 Modular Orchestrator — with full Warehouse recovery hooks
 * 
 * Every stage that can fail now saves its progress to warehouse_blueprints.
 * If a stage succeeds, it updates the draft with the saved asset path.
 * On full success, the draft is removed from Warehouse and committed to Library.
 */
async function start(config = {}) {
    const {
        mode, customBlueprint, resumeBlueprint, affiliateLink,
        topic, script, contextPrompt, template,
        warehouseId,       // If resuming an existing warehouse draft
        warehouseBgMode,   // bg_mode to tag this run with
        resumeFromAudio,   // pre-existing audio path to skip Phase 2
        resumeFromImages,  // pre-existing image array to skip Phase 3
        voice,
    } = config;

    let selectedTemplate = template || 'STANDARD';
    if (!template && mode && mode.toLowerCase().includes('automated')) {
        selectedTemplate = Math.random() > 0.5 ? 'BRAINROT_SPLIT' : 'STANDARD';
    }
    const templateConfig = require('./modules/templates').TEMPLATES[selectedTemplate];

    // ── If no warehouseId, create a temp ID for tracking this run ──────────
    let activeWarehouseId = warehouseId || null; // mutable — may be assigned below for fresh runs
    const runWarehouseId = activeWarehouseId || `wh_${Date.now()}`; // legacy compat
    // STANDARD template = full-screen AI visuals, no background video needed.
    // For BRAINROT_SPLIT, fall back through env var to 'pinterest' as default.
    const bgMode = selectedTemplate === 'STANDARD'
        ? null
        : (warehouseBgMode || process.env.BG_VIDEO_MODE || 'pinterest');

    console.log(`\n=========================================`);
    console.log(`[ORCHESTRATOR] 🎬 Initiating AURA V2 Pipeline...`);
    console.log(`[ORCHESTRATOR] 📐 Layout: ${selectedTemplate} (${templateConfig.ratio})`);
    if (resumeBlueprint) console.log(`[ORCHESTRATOR] 📦 Warehouse Resume: ${runWarehouseId}`);
    if (topic) console.log(`[ORCHESTRATOR] 🎯 Topic: ${topic}`);
    console.log(`=========================================`);

    // MISSION PURGE: With per-mission sub-folders (tmp/visuals/{missionId}/),
    // we no longer need to nuke the whole directory. Instead, on a fresh run
    // we clean up any orphaned sub-folders older than 48h.
    // Warehouse resumes never touch any folder.
    if (!resumeBlueprint) {
        try {
            const fs = require('fs');
            const path = require('path');
            const visualsDir = path.join(__dirname, '../tmp/visuals');
            if (fs.existsSync(visualsDir)) {
                const cutoff = Date.now() - (48 * 60 * 60 * 1000); // 48h
                const entries = fs.readdirSync(visualsDir, { withFileTypes: true });
                let cleaned = 0;
                for (const entry of entries) {
                    const fullPath = path.join(visualsDir, entry.name);
                    try {
                        if (entry.isDirectory()) {
                            // Only remove mission sub-folders older than 48h
                            const stat = fs.statSync(fullPath);
                            if (stat.mtimeMs < cutoff) {
                                fs.rmSync(fullPath, { recursive: true, force: true });
                                cleaned++;
                            }
                        } else {
                            // Loose files in root (std_X.mp4, bg_stitched remnants) — always clean
                            fs.unlinkSync(fullPath);
                            cleaned++;
                        }
                    } catch {}
                }
                if (cleaned > 0) console.log(`[ORCHESTRATOR] 🧹 Cleaned ${cleaned} stale file(s)/folder(s) from tmp/visuals.`);
            }
        } catch (e) {
            console.warn(`[ORCHESTRATOR] ⚠️ Cache cleanup issue: ${e.message}`);
        }
    } else {
        console.log(`[ORCHESTRATOR] ♻️ Warehouse resume — visual cache preserved.`);
    }

    let generatedBlueprint = null;
    let audioRes = null;

    try {
        // ──────────────────────────────────────────────────────────────────────
        // PHASE 1 & 2: Script + Audio (Fast Queue)
        // ──────────────────────────────────────────────────────────────────────
        const queueData = await queueManager.enqueueFast(async () => {
            emitPhase('scripting');

            // Phase 1: Script
            if (resumeBlueprint) {
                generatedBlueprint = resumeBlueprint;
                console.log(`[BRAIN] 📝 Phase 1: Using Warehouse Blueprint directly...`);
            } else if (customBlueprint) {
                generatedBlueprint = customBlueprint;
                console.log(`[BRAIN] 📝 Phase 1: Using Custom Forge Blueprint...`);
            } else {
                console.log(`\n[BRAIN] 📝 Phase 1: Generating Script...`);
                const warehouseConfig = (mode === 'warehouse_draft') ? { isWarehouse: true } : null;
                generatedBlueprint = await scriptWriter.generateScript(
                    topic || null, script || null, affiliateLink || null, contextPrompt || null, null, warehouseConfig
                );
            }

            console.log(`[BRAIN] ✅ Blueprint: "${generatedBlueprint.title}"`);

            let missionId = generatedBlueprint._missionId;
            if (!missionId) {
                missionId = `${Date.now()}_${(generatedBlueprint.core_entity || 'mission').replace(/\s+/g, '_').toLowerCase()}`;
                generatedBlueprint._missionId = missionId;
            }
            console.log(`[ORCHESTRATOR] 🔖 Mission ID: ${missionId}`);

            // ── IMMEDIATE WAREHOUSE PERSISTENCE ──
            // If the backend crashes unexpectedly (unhandled panic), the user won't lose their data!
            if (!activeWarehouseId) {
                activeWarehouseId = `wh_active_${missionId}`;
                db.addWarehouseBlueprint(activeWarehouseId, {
                    title: generatedBlueprint.title,
                    topic: topic || '',
                    template: selectedTemplate,
                    bg_mode: bgMode,
                    blueprint: generatedBlueprint,
                    stage: 'scripted',
                    status: 'rendering', // Indicates active processing
                    logs: 'Pipeline running globally. Core blueprint locked.'
                });
            } else {
                db.updateWarehouseBlueprintStage(activeWarehouseId, 'scripted', 'rendering', 'Pipeline resuming active processing.');
            }

            // WAREHOUSE HALT — script only (no audio, no visuals)
            if (mode === 'warehouse_draft' || mode === 'script_only') {
                console.log(`[WAREHOUSE] 📦 Script generated. Saving to warehouse & halting.`);
                db.updateWarehouseBlueprintStage(activeWarehouseId, 'scripted', 'warehoused', 'Script generated via script_only mode.');
                return { isWarehouseDraft: true, blueprint: generatedBlueprint, warehouseId: activeWarehouseId };
            }

            // Phase 2: Audio — skip if warehouse had audio saved
            if (resumeFromAudio) {
                const fs = require('fs');
                console.log(`[AUDIO] ♻️  Phase 2: Reusing warehoused audio: ${resumeFromAudio}`);
                
                // Measure actual duration — do NOT hardcode 60s (causes short BG clips and freezes!)
                let actualDurationMs = 60000; // safe default
                try {
                    const { spawnSync } = require('child_process');
                    const ffprobePath = (() => {
                        try { const p = require('@ffprobe-installer/ffprobe').path; if (p && fs.existsSync(p)) return p; } catch {}
                        return 'ffprobe';
                    })();
                    const probe = spawnSync(ffprobePath, [
                        '-v', 'error', '-show_entries', 'format=duration',
                        '-of', 'default=noprint_wrappers=1:nokey=1', resumeFromAudio
                    ], { encoding: 'utf8', timeout: 10000 });
                    const measured = parseFloat(probe.stdout.trim());
                    if (!isNaN(measured) && measured > 0) {
                        actualDurationMs = measured * 1000;
                        console.log(`[AUDIO] ⏱️  Warehouse audio measured: ${measured.toFixed(2)}s`);
                    }
                } catch (probeErr) {
                    console.warn(`[AUDIO] ⚠️ Could not measure warehouse audio duration: ${probeErr.message}. Using 60s estimate.`);
                }
                
                audioRes = { path: resumeFromAudio, durationMs: actualDurationMs, timestamps: [] };
                warehouseLog(activeWarehouseId, 'has_audio', 'rendering', `Audio reused from warehouse: ${resumeFromAudio}`, { audio_path: resumeFromAudio });
            } else {
                console.log(`[ORCHESTRATOR] ⏳ Cooldown 15s before Audio...`);
                await sleep(INTER_STAGE_COOLDOWN);
                warehouseLog(activeWarehouseId, 'scripted', 'rendering', 'Cooldown complete. Starting audio synthesis...');

                console.log(`\n[AUDIO] ⚡ Phase 2: Synthesis & Duration Gate (30s–2:30min)...`);
                let retryCount = 0;
                const MAX_RETRIES = 3;
                while (retryCount < MAX_RETRIES) {
                    emitPhase('audio');
                    audioRes = await audioEngine.generateVoice(generatedBlueprint, voice);
                    const durationS = audioRes.durationMs / 1000;
                    if (durationS >= 30.0 && durationS <= 150.0) {
                        console.log(`[AUDIO] ✅ Duration OK: ${(durationS/60)|0}m ${(durationS%60).toFixed(1)}s`);
                        warehouseLog(activeWarehouseId, 'has_audio', 'rendering',
                            `Audio ready — ${(durationS/60)|0}m ${(durationS%60).toFixed(1)}s | ${audioRes.path}`,
                            { audio_path: audioRes.path });
                        break;
                    }
                    retryCount++;
                    const reason = durationS < 30 ? `TOO SHORT (${durationS.toFixed(1)}s)` : `TOO LONG (${durationS.toFixed(1)}s)`;
                    console.warn(`[BRAIN] ⚠️ Duration Guard: ${reason}. Retry ${retryCount}/${MAX_RETRIES}...`);
                    warehouseLog(activeWarehouseId, 'scripted', 'rendering', `Audio duration guard failed: ${reason}. Retrying ${retryCount}/${MAX_RETRIES}...`);
                    if (retryCount >= MAX_RETRIES) throw new Error(`Abort: Duration guard failed after ${MAX_RETRIES} retries.`);
                    emitPhase('scripting');
                    await sleep(INTER_STAGE_COOLDOWN);
                    const origNarration = generatedBlueprint.scenes.map(s => s.narration).join(' ');
                    generatedBlueprint = await scriptWriter.generateScript(topic, script, affiliateLink, contextPrompt, { duration: durationS, originalNarration: origNarration });
                }
            }

            // WAREHOUSE HALT — script + audio only (no visuals)
            if (mode === 'script_audio') {
                console.log(`[WAREHOUSE] 📦 Audio ready. Saving to warehouse & halting.`);
                db.updateWarehouseBlueprintStage(runWarehouseId, 'has_audio', 'warehoused',
                    'Halted after audio via script_audio mode.', { audio_path: audioRes.path });
                return { isWarehouseDraft: true, blueprint: generatedBlueprint, warehouseId: runWarehouseId, audioPath: audioRes.path };
            }

            return { blueprint: generatedBlueprint, voice: audioRes };
        });

        if (queueData.isWarehouseDraft) {
            emitPhase('complete');
            return { isWarehouseDraft: true, success: true, blueprint: queueData.blueprint };
        }

        const blueprint = queueData.blueprint;
        generatedBlueprint = blueprint;
        audioRes = queueData.voice;

        // ──────────────────────────────────────────────────────────────────────
        // PHASE 3 & 4: Visuals + Assembly (Heavy Queue)
        // ──────────────────────────────────────────────────────────────────────
        console.log(`[ORCHESTRATOR] ⏳ Cooldown 15s before Visual Engine...`);
        // Fetch mood-matched background music during the cooldown (zero added latency)
        let musicPath = null;
        const [,] = await Promise.allSettled([
            sleep(INTER_STAGE_COOLDOWN),
            musicEngine.getTrack(blueprint._pillar || '').then(p => { musicPath = p; }).catch(e => {
                console.warn(`[ORCHESTRATOR] ⚠️ Music fetch failed: ${e.message}. Continuing without music.`);
            })
        ]);
        if (musicPath) console.log(`[ORCHESTRATOR] 🎵 Music ready for assembly.`);

        const finalVideoPath = await queueManager.enqueueHeavy(async () => {
            let visualResults;

            if (selectedTemplate === 'FULLSCREEN_BG') {
                // ── FULLSCREEN_BG: Skip AI visuals entirely, use background video as canvas ──
                emitPhase('visuals');
                warehouseLog(activeWarehouseId, 'has_audio', 'rendering', `Phase 3: Fetching FULLSCREEN_BG (${bgMode}) for ${(audioRes.durationMs/1000).toFixed(1)}s...`);
                console.log(`\n[VISION] 🎥 Phase 3 (FULLSCREEN_BG): Fetching background video (${bgMode}) for full ${(audioRes.durationMs/1000).toFixed(1)}s...`);
                const bgEngine = require('./modules/background-video-engine');
                const fs = require('fs');
                const bgVisDir = require('path').join(__dirname, '../tmp/visuals');
                fs.mkdirSync(bgVisDir, { recursive: true }); // ensure dir exists after purge
                const bgOutPath = require('path').join(bgVisDir, 'bg_fullscreen.mp4');
                const bgResult = await bgEngine.getBackgroundSegment(bgMode, bgOutPath, (audioRes.durationMs / 1000) + 2);
                warehouseLog(activeWarehouseId, 'has_images', 'rendering', `BG video ready: ${bgResult.path}`);
                // Treat as a single video clip covering the whole timeline
                visualResults = [{ sceneIndex: 0, image: null, video: bgResult.path, type: 'video' }];
            } else if (resumeFromImages && Array.isArray(resumeFromImages) && resumeFromImages.length > 0) {
                console.log(`[VISION] ♻️  Phase 3: Reusing ${resumeFromImages.length} warehoused images...`);
                warehouseLog(activeWarehouseId, 'has_images', 'rendering', `Phase 3: Reusing ${resumeFromImages.length} cached images from warehouse.`);
                visualResults = resumeFromImages;
                emitPhase('visuals');
            } else {
                emitPhase('visuals');
                warehouseLog(activeWarehouseId, 'has_audio', 'rendering', `Phase 3: Starting AI visual generation for ${blueprint.scenes.length} scenes...`);
                console.log(`\n[VISION] 🎥 Phase 3: Generating ${blueprint.scenes.length} visuals...`);
                visualResults = await visualEngine.generateVisuals(blueprint, {
                    aspectRatio: templateConfig.ratio,
                    missionId: blueprint._missionId
                });

                // Save image progress to warehouse
                if (activeWarehouseId) {
                    warehouseLog(activeWarehouseId, 'has_images', 'rendering',
                        `Phase 3 complete: ${visualResults.length} AI images generated.`,
                        { images_json: visualResults });
                }
            }

            console.log(`[VISION] 🏁 Visuals complete.`);
            warehouseLog(activeWarehouseId, 'has_images', 'rendering', 'Phase 3 done. Starting thumbnail generation...');
            await visualEngine.generateThumbnail(blueprint);
            warehouseLog(activeWarehouseId, 'has_images', 'rendering', 'Thumbnail generated. Waiting cooldown before Assembly...');

            console.log(`[ORCHESTRATOR] ⏳ Cooldown 15s before Assembly...`);
            await sleep(INTER_STAGE_COOLDOWN);

            emitPhase('assembly');
            warehouseLog(activeWarehouseId, 'renderable', 'rendering', 'Phase 4 started: FFmpeg assembly ignited...');
            console.log(`\n[ASSEMBLE] ✂️ Phase 4: Assembling final video...`);
            const videoOut = await assemblyEngine.assemble(
                blueprint, visualResults, audioRes.path, affiliateLink || null, audioRes.timestamps, selectedTemplate, bgMode, musicPath
            );
            warehouseLog(activeWarehouseId, 'renderable', 'rendering', `Phase 4 complete. Output: ${videoOut}`);

            return videoOut;
        });

        // ──────────────────────────────────────────────────────────────────────
        // PHASE 5: DB commit & Warehouse cleanup
        // ──────────────────────────────────────────────────────────────────────
        console.log(`\n[DB] 📀 Phase 5: Committing to Library...`);

        let compiledDescription = blueprint.description || "Video generated by AURA-V2.";
        if (affiliateLink) compiledDescription += `\n\n🔗 GET IT HERE:\n${affiliateLink}`;
        if (Array.isArray(blueprint.hashtags) && blueprint.hashtags.length > 0) {
            compiledDescription += `\n\n${blueprint.hashtags.join(' ')}`;
        }

        db.addVideo({
            title: blueprint.title,
            description: compiledDescription,
            file_path: finalVideoPath,
            affiliate_link: affiliateLink || '',
            status: 'pending_approval',
            metadata: { mode: mode || 'automated', seed: blueprint.global_seed, duration: audioRes.durationMs / 1000 },
            core_entity: blueprint.core_entity || ''
        });

        // Remove from warehouse on success (it's now in the proper library)
        if (activeWarehouseId) {
            db.deleteWarehouseBlueprint(activeWarehouseId);
            console.log(`[WAREHOUSE] ✅ Draft ${activeWarehouseId} moved to Library. Warehouse entry cleared.`);
        }

        if (mode && mode.toLowerCase().includes('publish_auto')) {
            emitPhase('publish');
            console.log(`\n[GHOST-API] 👻 Phase 6: Sending to Publishing Daemon...`);
            
            // Allow the central server queue manager to take over so anchors are strictly respected
            db.updateStatusByPath(finalVideoPath, 'approved');
            
            try {
                // Find ID to enqueue it cleanly by API
                const all = db.getHistory();
                const matched = all.find(v => v.file_path === finalVideoPath);
                if (matched) {
                   await fetch('http://localhost:3000/api/db/approve', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: matched.id })
                   });
                   console.log(`[GHOST-API] ✅ Video queued automatically in Central Publishing Daemon.`);
                }
            } catch(e) {
                console.log(`[GHOST-API] ⚠️ Enqueue via API failed (Is Server running?). It remains approved and will publish on server restart.`);
            }
        }

        emitPhase('complete');
        return { success: true, message: `Video compiled: ${blueprint.title}` };

    } catch (error) {
        console.log(`\n[ORCHESTRATOR] ❌ FATAL: ${error.message}`);
        emitPhase('error');

        // ── Warehouse failure recovery — save current checkpoint ────────────
        if (generatedBlueprint && activeWarehouseId) {
            const failedAt = audioRes ? 'visuals' : 'audio';
            db.updateWarehouseBlueprintStage(
                activeWarehouseId,
                'error',
                'error',
                `Pipeline failed at [${failedAt}]: ${error.message}`,
                {
                    failure_stage: failedAt,
                    failure_reason: error.message,
                    audio_path: audioRes?.path || null
                }
            );
            console.log(`[WAREHOUSE] 🛟 Progress saved to warehouse entry ${activeWarehouseId} at stage: ${failedAt}`);
        } else if (generatedBlueprint && !activeWarehouseId) {
            // Was an anonymous run (not tracked) — create a new warehouse entry to preserve work
            const emergencyId = `wh_rescue_${Date.now()}`;
            const failedAt = audioRes ? 'visuals' : 'audio';
            db.addWarehouseBlueprint(emergencyId, {
                title: generatedBlueprint.title,
                topic: topic || '',
                template: selectedTemplate,
                bg_mode: bgMode,
                blueprint: generatedBlueprint,
                stage: audioRes ? 'has_audio' : 'scripted',
                status: 'error',
                audio_path: audioRes?.path || null,
                logs: `Auto-rescue on failure at [${failedAt}]: ${error.message}`
            });
            console.log(`[WAREHOUSE] 🛟 Emergency rescue: Saved partial work as ${emergencyId}`);
        }

        return { success: false, message: error.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE SHORT PIPELINE
// Independent of the main narrated pipeline: AI image + yt-dlp music → short
// ─────────────────────────────────────────────────────────────────────────────
async function startImageShort({ imageQuery, songQuery, clipSec }) {
    const fs   = require('fs');
    const path = require('path');
    const musicDownloader = require('./modules/music-downloader');
    const { assembleImageShort } = require('./modules/assembly-engine');
    const { callUnifiedModel, extractJSON } = require('./modules/script-writer');

    const missionId = `img_${Date.now()}`;
    const outDir    = path.join(__dirname, '../tmp/image_shorts');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Determine target clip duration (random between 15-40s if not specified/invalid, absolute max 40s)
    let finalClipSec = parseInt(clipSec, 10);
    if (!finalClipSec || finalClipSec < 10) {
        finalClipSec = Math.floor(Math.random() * 26) + 15; // 15 to 40 secs
    } else {
        finalClipSec = Math.min(finalClipSec, 40);
    }

    const imagePath = path.join(outDir, `${missionId}_img.jpg`);
    const musicPath = path.join(outDir, `${missionId}_music.mp3`);
    const finalOut  = path.join(outDir, `${missionId}_final.mp4`);

    emitPhase('scripting');
    console.log(`\n[IMAGE-SHORT] 🚀 Pipeline started — Mission: ${missionId}`);
    console.log(`[IMAGE-SHORT] 📝 Description: "${imageQuery}"`);
    console.log(`[IMAGE-SHORT] 🎵 Song: "${songQuery || 'AUTO-SELECT'}"`);
    console.log(`[IMAGE-SHORT] ⏱️  Target Length: ${finalClipSec}s`);

    // ── Step 0: AI Layout Analysis ────────────────────────────────────────────
    console.log(`[IMAGE-SHORT] 🧠 AI analysing layout and choosing music...`);
    let layout = {
        imageShape: 'portrait',
        imgW: 1080, imgH: 1920,
        imagePrompt: imageQuery,
        overlayText: null,
        textPosition: 'none',
        textStyle: 'bold',
        bgColor: 'black',
        aiSongQuery: songQuery || ''
    };

    try {
        const layoutPrompt = `You are a video layout analyst. A user wants to generate a short meme/video from a description.
They provided the description: "${imageQuery}"
And the song query: "${songQuery || ''}"

Analyse the description and return ONLY a JSON object with these exact fields:

{
  "imageShape": "square" | "portrait" | "landscape",
  "imagePrompt": "the actual image generation prompt, cleaned and enhanced for best AI output. Do not include layout instructions or text.",
  "overlayText": "the text to display on screen, or null if none",
  "textPosition": "above" | "below" | "center" | "none",
  "textStyle": "bold" | "italic" | "normal",
  "bgColor": "black" | "white" | "blur",
  "aiSongQuery": "a famous song name and artist that perfectly fits the vibe of the image, e.g. 'Blinding Lights The Weeknd' or 'Sigma phonk remix'. Crucial: You MUST choose a specific song IF the user's song query is empty. If they provided a song query, simply return that query."
}

Rules:
- Default imageShape is "portrait" if not specified.
- If the user implies a song in their description but didn't provide one, extract it for aiSongQuery.

IMPORTANT: Return ONLY the raw JSON object. NO markdown fences, no preamble.`;

        const rawText = await callUnifiedModel(layoutPrompt, "Expert Video Analyst", "IMAGE-SHORT-LAYOUT");
        const parsed = extractJSON(rawText);

        layout.imageShape   = parsed.imageShape  || 'portrait';
        layout.imagePrompt  = parsed.imagePrompt || imageQuery;
        layout.overlayText  = parsed.overlayText || null;
        layout.textPosition = parsed.textPosition || 'none';
        layout.textStyle    = parsed.textStyle   || 'bold';
        layout.bgColor      = parsed.bgColor     || 'black';
        if (!songQuery) layout.aiSongQuery = parsed.aiSongQuery || 'epic cinematic music';

        // Resolve pixel dimensions
        if (layout.imageShape === 'square')    { layout.imgW = 1080; layout.imgH = 1080; }
        else if (layout.imageShape === 'landscape') { layout.imgW = 1920; layout.imgH = 1080; }
        else                                   { layout.imgW = 1080; layout.imgH = 1920; }

        console.log(`[IMAGE-SHORT] ✅ Layout parsed → shape:${layout.imageShape} text:"${layout.overlayText}" pos:${layout.textPosition} song:"${layout.aiSongQuery}"`);
    } catch (e) {
        console.warn(`[IMAGE-SHORT] ⚠️ Layout analysis failed/exhausted: ${e.message}. Using defaults.`);
        if (!songQuery) layout.aiSongQuery = 'viral trending tiktok song';
    }

    const targetSong = layout.aiSongQuery || songQuery || 'viral trending tiktok song';

    // ── Step 1: Generate AI image ─────────────────────────────────────────────
    emitPhase('visuals');
    const seed = Math.floor(Math.random() * 999999);
    // Enhance the AI-cleaned prompt with quality tags (no shape/text instructions)
    const enhancedPrompt = `${layout.imagePrompt}, ultra HD, cinematic lighting, highly detailed, professional photography`;
    let imgGenSuccess = false;

    // TIER 1: Pollinations Free
    console.log(`[IMAGE-SHORT] 🎨 Tier 1: Pollinations Free (${layout.imgW}x${layout.imgH})...`);
    try {
        const freeUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=${layout.imgW}&height=${layout.imgH}&seed=${seed}&nologo=true`;
        const r = await fetch(freeUrl, { signal: AbortSignal.timeout(90_000) });
        if (r.ok) {
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > 5000) {
                fs.writeFileSync(imagePath, buf);
                imgGenSuccess = true;
                console.log(`[IMAGE-SHORT] ✅ Image via Pollinations Free (${Math.round(buf.length / 1024)}KB)`);
            } else throw new Error('Response too small');
        } else throw new Error(`HTTP ${r.status}`);
    } catch (e) {
        console.warn(`[IMAGE-SHORT] ⚠️ Pollinations Free failed: ${e.message}. Trying HuggingFace...`);
    }

    // TIER 2: HuggingFace FLUX.1-schnell
    if (!imgGenSuccess) {
        const hfToken = process.env.HF_TOKEN;
        if (!hfToken) {
            console.warn(`[IMAGE-SHORT] ⚠️ HF_TOKEN not set — skipping HF fallback.`);
        } else {
            try {
                console.log(`[IMAGE-SHORT] 🎨 Tier 2: HuggingFace FLUX.1-schnell...`);
                const hfUrl = 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';
                const r = await fetch(hfUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ inputs: enhancedPrompt }),
                    signal: AbortSignal.timeout(120_000)
                });
                if (!r.ok) throw new Error(`HF HTTP ${r.status}`);
                const buf = Buffer.from(await r.arrayBuffer());
                if (buf.length > 5000) {
                    fs.writeFileSync(imagePath, buf);
                    imgGenSuccess = true;
                    console.log(`[IMAGE-SHORT] ✅ Image via HuggingFace FLUX (${Math.round(buf.length / 1024)}KB)`);
                } else throw new Error('HF response too small');
            } catch (e) {
                console.error(`[IMAGE-SHORT] ❌ HuggingFace failed: ${e.message}`);
            }
        }
    }

    if (!imgGenSuccess) throw new Error('[IMAGE-SHORT] All image providers failed. Aborting.');

    // ── Step 2: Download + extract most energetic music clip ──────────────────
    emitPhase('audio');
    console.log(`[IMAGE-SHORT] 🎵 Fetching energetic clip of "${targetSong}"...`);
    await musicDownloader.getEnergeticClip(targetSong, musicPath, finalClipSec);

    // ── Step 3: Assemble with Ken Burns + layout + music ─────────────────────
    emitPhase('assembly');
    await assembleImageShort(imagePath, musicPath, finalOut, finalClipSec, layout);

    // ── Step 4: Commit to library ─────────────────────────────────────────────
    db.addVideo({
        title: `📸 ${layout.overlayText || imageQuery}`,
        description: `Image Short: ${imageQuery} | Music: ${targetSong}`,
        file_path: finalOut,
        status: 'pending_approval',
        metadata: { mode: 'image_short', imageQuery, songQuery: targetSong, clipSec: finalClipSec, layout },
        core_entity: imageQuery.split(' ').slice(0, 2).join(' ')
    });

    emitPhase('complete');
    console.log(`[IMAGE-SHORT] ✅ Mission complete → ${finalOut}`);
    return { success: true, path: finalOut };
}

module.exports = { start, startImageShort };


