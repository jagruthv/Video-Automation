/**
 * AURA-V2 Assembly Engine — Production-Ready
 *
 * Uses bundled ffmpeg-static + @ffprobe-installer (no system install needed).
 * Subtitle sync: Whisper AI → proportional math fallback.
 * All FFmpeg calls use spawn() with array args — zero shell-escaping issues.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
require('dotenv').config();
const { TEMPLATES, getRandomBackground } = require('./templates');

// ── Bundled Binary Paths ────────────────────────────────────────────────────
const FFMPEG_PATH = (() => {
    try {
        const p = require('ffmpeg-static');
        if (p && fs.existsSync(p)) return p;
    } catch {}
    return 'ffmpeg'; // system ffmpeg fallback
})();
const FFPROBE_PATH = (() => {
    try {
        const p = require('@ffprobe-installer/ffprobe').path;
        if (p && fs.existsSync(p)) return p;
    } catch {}
    return 'ffprobe'; // system ffprobe fallback
})();
console.log(`[ASSEMBLY] 🎬 FFmpeg: ${FFMPEG_PATH}`);
console.log(`[ASSEMBLY] 🔍 FFprobe: ${FFPROBE_PATH}`);

const XFADE_DURATION = 0.5;
const TMP_DIR = path.join(__dirname, '../../tmp');

/**
 * Windows FFmpeg .ass filter path escaper
 * Specifically handles the drive letter colon (D:/ -> D\\:/)
 */
function escapeAssPath(rawPath) {
    if (process.platform !== 'win32') return rawPath.replace(/\\/g, '/');
    // Use relative path from CWD (root) to bypass the drive-letter colon bug (D:/ -> tmp/...)
    const relPath = path.relative(process.cwd(), rawPath).replace(/\\/g, '/');
    // Use filename= protocol with the clean relative path
    return `filename='${relPath}'`;
}

// ── FFmpeg: spawn with array args (no shell, no escaping issues) ────────────
function ffmpeg(args, description = '', timeoutSec = 720) {
    return new Promise((resolve, reject) => {
        if (description) console.log(`[ASSEMBLY] ⚙️ ${description}`);
        const proc = spawn(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', ...args], {
            stdio: ['ignore', 'ignore', 'pipe']
        });
        let stderr = '';
        let finished = false;

        const killTimer = setTimeout(() => {
            if (!finished) {
                proc.kill('SIGKILL');
                reject(new Error(`FFmpeg timed out after ${timeoutSec}s. Killed. Stderr: ${stderr.slice(-400)}`));
            }
        }, timeoutSec * 1000);

        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => {
            finished = true;
            clearTimeout(killTimer);
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg error (exit ${code}): ${stderr.slice(-800)}`));
        });
        proc.on('error', e => {
            finished = true;
            clearTimeout(killTimer);
            reject(new Error(`FFmpeg spawn failed: ${e.message}`));
        });
    });
}

// ── FFprobe: get duration in seconds ───────────────────────────────────────
function getDuration(filePath) {
    const r = spawnSync(FFPROBE_PATH, [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', filePath
    ], { encoding: 'utf8', timeout: 10000 });
    if (r.error) throw r.error;
    const d = parseFloat(r.stdout.trim());
    if (isNaN(d)) throw new Error(`FFprobe returned non-numeric duration: "${r.stdout.trim()}"`);
    return d;
}

// ── Subtitle Timing: Whisper → Math fallback ───────────────────────────────
// ── Subtitle Timing: Neural Feed (Zero-Cost) → Math fallback ───────────────────────────────
async function pacedTimestamps(audioPath, narration, preComputedWords = null) {
    if (preComputedWords && preComputedWords.length > 0) {
        console.log(`[Pacer] ✅ 🧠 Neural Sync: 100% match via Edge-Metadata (${preComputedWords.length} words)`);
        return preComputedWords;
    }

    console.log('[Pacer] 🔍 Activating Local Whisper AI (tiny.en) for millisecond-exact alignment...');
    try {
        const alignerScript = path.join(__dirname, '..', '..', 'scripts', 'whisper_aligner.py');
        const jsonOut = audioPath.replace('.mp3', '_words.json');
        
        // Spawn Python. Allow up to 3 minutes purely for the first-time model download via huggingface.
        const result = spawnSync('python', [alignerScript, audioPath, jsonOut], { encoding: 'utf8', timeout: 180000 });
        
        if (result.error) throw result.error;
        if (result.stderr && result.stderr.includes('ALIGNMENT_ERROR')) throw new Error(result.stderr);

        if (fs.existsSync(jsonOut)) {
            const wordData = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
            if (wordData && wordData.length > 0) {
                 console.log(`[Pacer] ✅ 🎯 Flawless Deep-Alignment Sync achieved (${wordData.length} words).`);
                 fs.unlinkSync(jsonOut); // Cleanup
                 return wordData;
            }
        }
    } catch(err) {
        console.warn(`[Pacer] ⚠️ Whisper Alignment Failed (${err.message.split('\n')[0]}). Falling back to simple Math Pacing.`);
    }

    console.log('[Pacer] System Error: Falling back to math pacing (Sync may drift)');
    // Math fallback: distribute time proportional to character count
    const total = getDuration(audioPath) * 1000;
    const words = narration.split(/\s+/).filter(w => w.length > 0);
    const totalChars = words.reduce((s, w) => s + w.length, 0);
    let offset = 0;
    return words.map(w => {
        const dur = (w.length / totalChars) * total;
        const e = { startMs: offset, endMs: offset + dur, word: w };
        offset += dur;
        return e;
    });
}

// ── ASS Subtitle File Generator (AURA-V2 Brainrot Style) ─────────────────────
function writeASS(wordTimestamps, outputPath, templateId = 'STANDARD', maxMs = Infinity) {
    const template = TEMPLATES[templateId] || TEMPLATES.STANDARD;
    const fmt = ms => {
        const s = ms / 1000;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const cs = Math.round((s % 1) * 100);
        return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
    };

    const lines = [
        '[Script Info]', 'ScriptType: v4.00+', `PlayResX: 1080`, `PlayResY: ${template.height}`, '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        // Karaoke highlight: active word = yellow (#00FFFF in ASS BGR), default = white
        `Style: Main,Arial Black,96,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,6,3,2,40,40,${template.subtitleMarginV},1`,
        '', '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
    ];

    // Global Subtitle Shift: Move subs 500ms earlier so they appear exactly on time
    const SHIFT_BACK_MS = 500;
    const adjustedTimestamps = wordTimestamps.map(w => ({
        word: w.word,
        startMs: Math.max(0, w.startMs - SHIFT_BACK_MS),
        endMs: Math.max(0, w.endMs - SHIFT_BACK_MS)
    }));

    // BRAINROT CHUNKING: 2-3 word blocks for natural reading rhythm.
    // Very short words (articles, prepositions) always group with next.
    // Very long words (>10 chars) get their own block.
    let i = 0;
    while (i < adjustedTimestamps.length) {
        const w1 = adjustedTimestamps[i];
        const w2 = adjustedTimestamps[i + 1];
        const w3 = adjustedTimestamps[i + 2];

        let chunkSize = 1;

        if (w1.word.length > 10) {
            // Very long word — solo block
            chunkSize = 1;
        } else if (w2) {
            if (w1.word.length <= 3) {
                // Very short word (a, in, the, is) — always pull next word in
                chunkSize = w3 && w2.word.length <= 8 ? 3 : 2;
            } else if (w2.word.length > 10) {
                // Next word is very long — keep it separate
                chunkSize = 1;
            } else {
                // Normal words: try to group 2-3
                chunkSize = (w3 && w2.word.length <= 6 && w3.word.length <= 6) ? 3 : 2;
            }
        }
        
        // If current word is very long, force it to be alone (already handled by chunkSize=1)

        const chunk = adjustedTimestamps.slice(i, i + chunkSize);
        i += chunkSize;
        
        const start = fmt(chunk[0].startMs);
        const end = fmt(chunk[chunk.length - 1].endMs);
        
        let karaokeText = '';
        chunk.forEach((w, idx) => {
            const durationCs = Math.max(1, Math.round((w.endMs - w.startMs) / 10));
            const gapCs = idx > 0 ? Math.max(0, Math.round((w.startMs - chunk[idx-1].endMs) / 10)) : 0;
            
            if (gapCs > 0) karaokeText += `{\\k${gapCs}} `;
            // \kf = karaoke fill — word highlights in yellow as it's spoken, rest stays white
            karaokeText += `{\\kf${durationCs}}${w.word.toUpperCase()} `;
        });

        lines.push(`Dialogue: 0,${start},${end},Main,,0,0,0,,{\\fad(50,0)}${karaokeText.trim()}`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
    console.log(`[Pacer] ✅ ${Math.ceil(wordTimestamps.length / 3)} karaoke events written`);
}

// ── Main Assembly ────────────────────────────────────────────
// musicPath: optional background music to mix at 8% under voice
async function assemble(blueprint, visualResults, voicePath, affiliateLink = null, voiceTimestamps = null, templateId = 'STANDARD', bgMode = null, musicPath = null) {
    const template = TEMPLATES[templateId] || TEMPLATES.STANDARD;
    const effectiveId = template.id; // resolved ID (handles BRAINROT_SPLIT alias)
    const isSplit       = effectiveId === 'GAMING_LEGACY';
    const isGamingOverlay = effectiveId === 'GAMING_OVERLAY';
    const outDir = path.join(TMP_DIR, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(path.join(TMP_DIR, 'audio'), { recursive: true });
    fs.mkdirSync(path.join(TMP_DIR, 'visuals'), { recursive: true });

    const finalOut  = path.join(outDir, `aura_${Date.now()}.mp4`);
    const normAudio = path.join(TMP_DIR, 'audio', 'voice_norm.mp3');
    const subsFile  = path.join(TMP_DIR, 'subtitles.ass');

    // 1. Normalize audio
    await ffmpeg([
        '-y', '-i', voicePath,
        '-af', 'volume=2.0,loudnorm=I=-11:TP=-1.5,apad=pad_dur=1',
        normAudio
    ], 'Normalizing audio...');

    const audioDur = getDuration(normAudio);
    console.log(`[ASSEMBLY] Audio: ${audioDur.toFixed(2)}s`);

    // 2. Subtitles
    const narration = blueprint.scenes.map(s => s.narration).join(' ');
    const timestamps = await pacedTimestamps(normAudio, narration, voiceTimestamps);
    writeASS(timestamps, subsFile, templateId);

    // 3. Standardize clips
    const totalVid = audioDur + ((visualResults.length - 1) * XFADE_DURATION) + 0.5;
    const clipDur  = totalVid / visualResults.length;
    const frames   = Math.ceil(clipDur * 30);
    console.log(`[ASSEMBLY] 🎞️ Processing ${visualResults.length} segments (${clipDur.toFixed(2)}s per clip)...`);

    const segments = [];
    const segmentHasAudio = new Map();
    for (let i = 0; i < visualResults.length; i++) {
        const res = visualResults[i];
        const input = res.video || res.image;
        if (!input || !fs.existsSync(input)) {
            console.warn(`[ASSEMBLY] Scene ${i}: no input, skipping`);
            continue;
        }
        const segOut = path.join(TMP_DIR, 'visuals', `std_${i}.mp4`);

        if (res.video) {
            // Probe for audio stream
            const probeResult = spawnSync(FFPROBE_PATH, [
                '-v', 'error', '-select_streams', 'a:0',
                '-show_entries', 'stream=codec_type',
                '-of', 'csv=p=0', input
            ], { encoding: 'utf8', timeout: 8000 });
            const hasAudio = probeResult.stdout.trim() === 'audio';
            segmentHasAudio.set(i, hasAudio);
            if (hasAudio) {
                const label = templateId === 'FULLSCREEN_BG' ? '🔇 Muting it.' : 'will mix at 30%.';
                console.log(`[ASSEMBLY] 🎵 Scene ${i + 1}: video has audio — ${label}`);
            }

            if (templateId === 'FULLSCREEN_BG') {
                // BG video is already 1080x1920 h264 from background-video-engine.
                // Stream-copy + trim — no re-encode needed (≪1s vs ~60s re-encode).
                console.log(`[ASSEMBLY] ⚙️ Scene ${i + 1}: BG video stream-copy trim...`);
                await ffmpeg([
                    '-y', '-stream_loop', '-1', '-i', input,
                    '-t', clipDur.toFixed(3),
                    '-c:v', 'copy', '-an', segOut
                ], ``, 120);
            } else {
                // By unconditionally looping we protect against short clips dropping the visual timeline
                await ffmpeg([
                    '-y', '-stream_loop', '-1', '-i', input,
                    '-t', clipDur.toFixed(3),
                    '-vf', `scale=${template.width}:${template.height}:force_original_aspect_ratio=increase,crop=${template.width}:${template.height},setsar=1,fps=30`,
                    '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-an', segOut
                ], `Scene ${i + 1}: video (${template.ratio})`);
            }
        } else {
            segmentHasAudio.set(i, false);
            // Ken Burns with ALTERNATING direction — pattern interrupt every cut
            // Even scenes: zoom IN (1.0 → 1.05) | Odd scenes: zoom OUT (1.05 → 1.0)
            const zoomIn  = `scale=${template.width+120}:${template.height+220},zoompan=z='if(lte(on,1),1.05,max(zoom-0.0012,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${template.width}x${template.height}:fps=30,setsar=1`;
            const zoomOut = `scale=${template.width+120}:${template.height+220},zoompan=z='if(lte(on,1),1.0,min(zoom+0.0012,1.05))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${template.width}x${template.height}:fps=30,setsar=1`;
            await ffmpeg([
                '-y', '-loop', '1', '-i', input,
                '-t', clipDur.toFixed(3),
                '-vf', i % 2 === 0 ? zoomIn : zoomOut,
                '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-an', segOut
            ], `Scene ${i + 1}: image→video (${i % 2 === 0 ? 'zoom-in' : 'zoom-out'})`);
        }
        segments.push(segOut);
    }

    if (segments.length === 0) throw new Error('No valid segments generated');

    // 4. Stitch
    const stitched = path.join(TMP_DIR, 'bg_stitched.mp4');
    if (segments.length === 1) {
        fs.copyFileSync(segments[0], stitched);
    } else {
        const inputs = segments.flatMap(s => ['-i', s]);
        const filterIn = segments.map((_, i) => `[${i}:v]`).join('');
        await ffmpeg([
            '-y', ...inputs,
            '-filter_complex', `${filterIn}concat=n=${segments.length}:v=1:a=0[v]`,
            '-map', '[v]', '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', stitched
        ], 'Stitching clips...');
    }

    // 5. Build ambient audio mix from Veo clips
    // MUTE BACKGROUNDS: For FULLSCREEN_BG, the visual result is the Pinterest/Sand background.
    // We strictly do NOT want to mix its sound, only AI-generated Veo clips get mixed.
    const veoAudioClips = [];
    if (templateId !== 'FULLSCREEN_BG') {
        for (let i = 0; i < visualResults.length; i++) {
            const res = visualResults[i];
            if (res.video && segmentHasAudio.get(i) && fs.existsSync(res.video)) {
                veoAudioClips.push(res.video);
            }
        }
    }

    let ambientAudioPath = null;
    if (veoAudioClips.length > 0) {
        console.log(`[ASSEMBLY] 🎛️ Mixing ${veoAudioClips.length} Veo ambient tracks at 30% volume...`);
        ambientAudioPath = path.join(TMP_DIR, 'audio', 'veo_ambient.aac');
        // Concat all Veo audio tracks and mix down at 30% volume
        const ambInputs = veoAudioClips.flatMap(v => ['-i', v]);
        const ambFilters = veoAudioClips.map((_, i) => `[${i}:a]volume=0.30[a${i}]`).join(';');
        const ambMixInputs = veoAudioClips.map((_, i) => `[a${i}]`).join('');
        await ffmpeg([
            '-y', ...ambInputs,
            '-filter_complex', `${ambFilters};${ambMixInputs}amix=inputs=${veoAudioClips.length}:duration=longest[amb]`,
            '-map', '[amb]', '-c:a', 'aac', '-b:a', '128k',
            '-t', (audioDur + 1).toFixed(3), ambientAudioPath
        ], 'Extracting Veo ambient audio mix...');
    }

    // 6. Burn subtitles + merge audio (voice 200% + optional Veo ambient 30%)
    const assFilterValue = escapeAssPath(subsFile);
    const finalFilters = [`ass=${assFilterValue}`];

    // Build final audio filter.
    // voice is already loudnorm-boosted. Ambient mixed via amix weights.
    // Music track: sped up 1.25x via atempo, then mixed at 15% volume
    const buildFinalAudio = (voiceInputIdx, ambInputIdx = null, musicInputIdx = null) => {
        const inputs_list = [`[${voiceInputIdx}:a]`];
        const weights = ['1'];
        if (ambInputIdx !== null) { inputs_list.push(`[${ambInputIdx}:a]`); weights.push('0.25'); }
        if (musicInputIdx !== null) { inputs_list.push(`[music_fast]`); weights.push('0.15'); }
        if (inputs_list.length === 1) return `[${voiceInputIdx}:a]anull[a]`;
        return `${inputs_list.join('')}amix=inputs=${inputs_list.length}:duration=first:weights=${weights.join(' ')}[a]`;
    };

    // Use -stream_loop -1 on stitched video so it loops if audio is longer (second defence against freeze).
    // Also prep music input if provided
    const hasMusicTrack = musicPath && fs.existsSync(musicPath);
    if (hasMusicTrack) console.log(`[ASSEMBLY] 🎵 Background music track: ${path.basename(musicPath)} (1.25x speed)`);
    // Music pre-filter: speed up 1.25x before mixing into the final output
    const musicPreFilter = hasMusicTrack ? `,atempo=1.25` : '';
    const musicAtempoFilterGraph = hasMusicTrack ? `[MUSICIDX:a]atempo=1.25[music_fast]` : null;

    let inputs = ['-y', '-stream_loop', '-1', '-i', stitched, '-i', normAudio];
    if (ambientAudioPath && fs.existsSync(ambientAudioPath)) {
        inputs = ['-y', '-stream_loop', '-1', '-i', stitched, '-i', normAudio, '-i', ambientAudioPath];
    }
    const hasAmb   = !!(ambientAudioPath && fs.existsSync(ambientAudioPath));
    const hasMusic = !!(hasMusicTrack);

    if (isGamingOverlay) {
        // ── GAMING_OVERLAY: 5% top gap | 16:9 content | gaming below ──────────
        const bgEngine = require('./background-video-engine');
        const bgClipPath = path.join(TMP_DIR, 'visuals', 'gaming_bg.mp4');
        let bgPath = null;
        try {
            const bgResult = await bgEngine.getBackgroundSegment(bgMode || 'gaming', bgClipPath, audioDur + 2);
            bgPath = bgResult.path;
        } catch (bgErr) {
            console.warn(`[ASSEMBLY] ⚠️ BG engine failed: ${bgErr.message}. Falling back to static folder.`);
            bgPath = getRandomBackground();
        }

        if (bgPath && fs.existsSync(bgPath)) {
            console.log(`[ASSEMBLY] 🎮 GAMING_OVERLAY: bg=${path.basename(bgPath)}, contentY=${template.contentY}px`);
            // bg=0, fg=1, voice=2, [amb=3 optional], [music=3 or 4 optional]
            const overlayInputs = ['-y', '-stream_loop', '-1', '-i', bgPath, '-i', stitched, '-i', normAudio,
                ...(hasAmb ? ['-i', ambientAudioPath] : []),
                ...(hasMusic ? ['-i', musicPath] : [])];
            const voiceIdx = 2;
            const ambIdx   = hasAmb   ? 3 : null;
            const musicIdx = hasMusic ? (hasAmb ? 4 : 3) : null;
            const audioFilter = buildFinalAudio(voiceIdx, ambIdx, musicIdx);
            const musicPrechain = hasMusic ? `[${musicIdx}:a]atempo=1.25[music_fast];` : '';
            const complexFilter =
                `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg];` +
                `[1:v]scale=${template.contentW}:${template.contentH}:force_original_aspect_ratio=increase,crop=${template.contentW}:${template.contentH},setsar=1[fg];` +
                `[bg][fg]overlay=0:${template.contentY}[combined];[combined]${finalFilters[0]}[v];${musicPrechain}${audioFilter}`;
            await ffmpeg([
                ...overlayInputs,
                '-filter_complex', complexFilter,
                '-map', '[v]', '-map', '[a]',
                '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
                '-c:a', 'aac', '-b:a', '192k',
                '-t', (audioDur + 1).toFixed(3),
                finalOut
            ], `Burning background + overlay + subtitles (GAMING_OVERLAY)...`, 720);
        } else {
            console.warn(`[ASSEMBLY] ⚠️ Gaming background missing. Falling back to STANDARD.`);
            const stdFallback = ['-y', '-i', stitched, '-i', normAudio,
                ...(hasAmb ? ['-i', ambientAudioPath] : []),
                ...(hasMusic ? ['-i', musicPath] : [])];
            const ambFbIdx   = hasAmb   ? 2 : null;
            const musicFbIdx = hasMusic ? (hasAmb ? 3 : 2) : null;
            const audioFallback = buildFinalAudio(1, ambFbIdx, musicFbIdx);
            const musicPrechainFb = hasMusic ? `[${musicFbIdx}:a]atempo=1.25[music_fast];` : '';
            await ffmpeg([
                ...stdFallback,
                '-filter_complex', `[0:v]${finalFilters[0]}[v];${musicPrechainFb}${audioFallback}`,
                '-map', '[v]', '-map', '[a]',
                '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
                '-c:a', 'aac', '-b:a', '192k',
                '-t', (audioDur + 1).toFixed(3),
                finalOut
            ], 'Burning subtitles + audio (GAMING_OVERLAY fallback)...', 720);
        }
    } else if (isSplit) {
        // ── GAMING_LEGACY: original 50/50 stacked layout ─────────────────────
        const bgEngine = require('./background-video-engine');
        const bgClipPath = path.join(TMP_DIR, 'visuals', 'gaming_bg.mp4');
        let bgPath = null;
        try {
            const bgResult = await bgEngine.getBackgroundSegment(bgMode || 'gaming', bgClipPath, audioDur + 2);
            bgPath = bgResult.path;
        } catch (bgErr) {
            console.warn(`[ASSEMBLY] ⚠️ Background video engine failed: ${bgErr.message}. Falling back to static folder.`);
            bgPath = getRandomBackground();
        }

        if (bgPath && fs.existsSync(bgPath)) {
            console.log(`[ASSEMBLY] 🎮 GAMING_LEGACY: Dual video. Background: ${path.basename(bgPath)}`);
            const splitInputs = ['-y', '-stream_loop', '-1', '-i', bgPath, '-i', stitched, '-i', normAudio,
                ...(hasAmb ? ['-i', ambientAudioPath] : []),
                ...(hasMusic ? ['-i', musicPath] : [])];
            const voiceIdx  = 2;
            const ambIdx    = hasAmb   ? 3 : null;
            const musicIdx  = hasMusic ? (hasAmb ? 4 : 3) : null;
            const audioFilter = buildFinalAudio(voiceIdx, ambIdx, musicIdx);
            const musicPrechain2 = hasMusic ? `[${musicIdx}:a]atempo=1.25[music_fast];` : '';
            const complexFilter =
                `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg];` +
                `[1:v]scale=${template.width}:${template.height}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
                `[bg][fg]overlay=0:0[combined];[combined]${finalFilters[0]}[v];${musicPrechain2}${audioFilter}`;
            await ffmpeg([
                ...splitInputs,
                '-filter_complex', complexFilter,
                '-map', '[v]', '-map', '[a]',
                '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
                '-c:a', 'aac', '-b:a', '192k',
                '-t', (audioDur + 1).toFixed(3),
                finalOut
            ], `Burning background + foreground + subtitles (GAMING_LEGACY)...`, 720);
        } else {
            console.warn(`[ASSEMBLY] ⚠️ Background missing. Falling back to STANDARD.`);
            const stdInputs2 = ['-y', '-i', stitched, '-i', normAudio,
                ...(hasAmb ? ['-i', ambientAudioPath] : []),
                ...(hasMusic ? ['-i', musicPath] : [])];
            const amb2Idx   = hasAmb   ? 2 : null;
            const music2Idx = hasMusic ? (hasAmb ? 3 : 2) : null;
            const audioFilter2 = buildFinalAudio(1, amb2Idx, music2Idx);
            const musicPrechain3 = hasMusic ? `[${music2Idx}:a]atempo=1.25[music_fast];` : '';
            await ffmpeg([
                ...stdInputs2,
                '-filter_complex', `[0:v]${finalFilters[0]}[v];${musicPrechain3}${audioFilter2}`,
                '-map', '[v]', '-map', '[a]',
                '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
                '-c:a', 'aac', '-b:a', '192k',
                '-t', (audioDur + 1).toFixed(3),
                finalOut
            ], 'Burning subtitles + audio (SPLIT fallback)...', 720);
        }
    } else {
        // ── STANDARD / FULLSCREEN_BG ──────────────────────────────────────────
        const stdInputs  = ['-y', '-i', stitched, '-i', normAudio,
            ...(hasAmb ? ['-i', ambientAudioPath] : []),
            ...(hasMusic ? ['-i', musicPath] : [])];
        const stdAmbIdx   = hasAmb   ? 2 : null;
        const stdMusicIdx = hasMusic ? (hasAmb ? 3 : 2) : null;
        const audioFilter = buildFinalAudio(1, stdAmbIdx, stdMusicIdx);
        const musicPrechainStd = hasMusic ? `[${stdMusicIdx}:a]atempo=1.25[music_fast];` : '';
        await ffmpeg([
            ...stdInputs,
            '-filter_complex', `[0:v]${finalFilters[0]}[v];${musicPrechainStd}${audioFilter}`,
            '-map', '[v]', '-map', '[a]',
            '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
            '-c:a', 'aac', '-b:a', '192k',
            '-t', (audioDur + 1).toFixed(3),
            finalOut
        ], 'Burning subtitles + audio (final render)...', 720);
    }

    const fileSizeKB = fs.existsSync(finalOut) ? (fs.statSync(finalOut).size / 1024).toFixed(0) : '?';
    console.log(`[ASSEMBLY] ✅ Output: ${finalOut} (${fileSizeKB} KB)`);

    // Auto-cleanup: remove intermediate render files
    try {
        if (fs.existsSync(stitched)) fs.unlinkSync(stitched);
        if (fs.existsSync(subsFile)) fs.unlinkSync(subsFile);
        if (fs.existsSync(normAudio)) fs.unlinkSync(normAudio);
        if (ambientAudioPath && fs.existsSync(ambientAudioPath)) fs.unlinkSync(ambientAudioPath);
        segments.forEach(s => { try { fs.unlinkSync(s); } catch {} });
        console.log(`[ASSEMBLY] 🧹 Intermediate files cleaned.`);
    } catch (cleanErr) {
        console.warn(`[ASSEMBLY] ⚠️ Cleanup partial: ${cleanErr.message}`);
    }

    return finalOut;
}

module.exports = { assemble };

// ────────────────────────────────────────────────────────────────────────────
// IMAGE SHORT ASSEMBLY
// Single AI image + Ken Burns + layout-aware canvas + text overlay + music
// ────────────────────────────────────────────────────────────────────────────

/**
 * Assemble an IMAGE_SHORT (meme/pic short format).
 * @param {string} imagePath   - Source image (jpg/png)
 * @param {string} musicPath   - Pre-clipped energetic music MP3
 * @param {string} outputPath  - Output MP4 path
 * @param {number} durationSec - Duration in seconds (matches music clip)
 * @param {object} layout      - AI-parsed layout descriptor from orchestrator
 */
async function assembleImageShort(imagePath, musicPath, outputPath, durationSec = 20, layout = {}) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const {
        imageShape   = 'portrait',
        overlayText  = null,
        textPosition = 'none',
        textStyle    = 'bold',
        bgColor      = 'black',
    } = layout;

    console.log(`\n[IMAGE-SHORT] 🖼️  Assembling — shape:${imageShape} text:"${overlayText}" pos:${textPosition}`);
    console.log(`[IMAGE-SHORT] 📸 ${path.basename(imagePath)} | 🎵 ${path.basename(musicPath)} | ⏱️ ${durationSec}s`);

    const fps         = 25;
    const totalFrames = Math.ceil(durationSec * fps);
    const canvasW     = 1080;
    const canvasH     = 1920;

    // ── 1. Resolve display dimensions for the image on the canvas ──────────
    const hasText    = !!(overlayText && textPosition !== 'none');
    const TEXT_PAD   = hasText ? 220 : 0;   // px reserved for text strip

    let dispW, dispH, padX, padY;

    if (imageShape === 'square') {
        // Square: fit 1:1 inside canvas, leave TEXT_PAD for the text strip
        dispH = canvasH - TEXT_PAD - 80;   // 40px margin top+bottom
        dispW = dispH;                      // 1:1
        padX  = Math.round((canvasW - dispW) / 2);
    } else if (imageShape === 'landscape') {
        // Landscape 16:9: scale to full width, letterbox vertically
        dispW = canvasW;
        dispH = Math.round(canvasW * 9 / 16); // ~607px
        padX  = 0;
    } else {
        // Portrait: full canvas
        dispW = canvasW;
        dispH = canvasH;
        padX  = 0;
    }

    // ── 2. Vertical placement of image + text ─────────────────────────────
    // text strip height is ~TEXT_PAD px
    let imgOffsetY;   // top-left Y of image on canvas
    let textY_expr;   // FFmpeg drawtext y expression

    if (!hasText || imageShape === 'portrait') {
        imgOffsetY = Math.round((canvasH - dispH) / 2);
        textY_expr = '(h-text_h)/2';           // center (used only for portrait)
    } else if (textPosition === 'above') {
        // text at top, image below
        imgOffsetY = TEXT_PAD + 20;
        textY_expr = String(Math.round(TEXT_PAD / 2 - 30));
    } else if (textPosition === 'below') {
        // image at top, text below
        imgOffsetY = 40;
        textY_expr = String(imgOffsetY + dispH + Math.round((canvasH - imgOffsetY - dispH) / 2) - 30);
    } else {
        // center text  (overlay on image)
        imgOffsetY = Math.round((canvasH - dispH) / 2);
        textY_expr = '(h-text_h)/2';
    }

    padY = imgOffsetY;

    // ── 3. Ken Burns at DISPLAY resolution ────────────────────────────────
    const kbZoom = `z='min(pzoom+0.0008,1.3)'`;
    const kbX    = `x='iw/2-(iw/zoom/2)+sin(on/${fps})*4'`;
    const kbY    = `y='ih/2-(ih/zoom/2)'`;
    const kbZP   = `zoompan=${kbZoom}:${kbX}:${kbY}:d=${totalFrames}:s=${dispW}x${dispH}:fps=${fps}`;

    const bgFill = bgColor === 'white' ? 'white' : 'black';

    // ── 4. Build video filter chain ────────────────────────────────────────
    // scale → crop to display size → Ken Burns → pad to canvas → vignette → [drawtext] → format
    let vFilter =
        `[0:v]scale=${dispW}:${dispH}:force_original_aspect_ratio=increase,` +
        `crop=${dispW}:${dispH},setsar=1,` +
        `${kbZP},` +
        `pad=${canvasW}:${canvasH}:${padX}:${padY}:${bgFill},` +
        `vignette=PI/6`;

    // ── 5. Text overlay via drawtext ───────────────────────────────────────
    if (hasText) {
        // Escape for FFmpeg drawtext: colons, backslashes, brackets
        const safeText = overlayText
            .replace(/\\/g, '/')
            .replace(/'/g, '\u2019')       // curly apostrophe — avoids filter parser issue
            .replace(/:/g, '\\:')
            .replace(/\[/g, '\\[')
            .replace(/\]/g, '\\]');

        // Font selection (Windows system fonts)
        const FONTS = {
            bold:   'C\\:/Windows/Fonts/arialbd.ttf',
            italic: 'C\\:/Windows/Fonts/ariali.ttf',
            normal: 'C\\:/Windows/Fonts/arial.ttf',
        };
        const fontFile  = FONTS[textStyle] || FONTS.bold;
        const fontSize  = imageShape === 'portrait' ? 52 : 58;
        const fontColor = bgColor === 'white' ? 'black' : 'white';
        const boxColor  = bgColor === 'white' ? 'white@0.85' : 'black@0.55';
        const textXExpr = '(w-text_w)/2';

        vFilter +=
            `,drawtext=fontfile='${fontFile}'` +
            `:text='${safeText}'` +
            `:fontsize=${fontSize}` +
            `:fontcolor=${fontColor}` +
            `:x=${textXExpr}` +
            `:y=${textY_expr}` +
            `:box=1:boxcolor=${boxColor}:boxborderw=18` +
            `:line_spacing=6`;
    }

    vFilter += `,format=yuv420p[v]`;

    // Audio: normalise to -14 LUFS
    const aFilter = `[1:a]loudnorm=I=-14:LRA=7:TP=-2[a]`;

    await ffmpeg([
        '-y',
        '-loop', '1',
        '-i', imagePath,
        '-i', musicPath,
        '-filter_complex', `${vFilter};${aFilter}`,
        '-map', '[v]',
        '-map', '[a]',
        '-t', String(durationSec),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest',
        '-movflags', '+faststart',
        outputPath
    ], `Rendering IMAGE_SHORT (${imageShape} + ${hasText ? `"${overlayText}"` : 'no text'})...`, 180);

    console.log(`[IMAGE-SHORT] ✅ Done: ${path.basename(outputPath)}`);
    return outputPath;
}

module.exports = { assemble, assembleImageShort };


