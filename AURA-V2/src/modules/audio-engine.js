const fs = require('fs');
const path = require('path');
require('dotenv').config();

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * AURA-V2 Audio Engine
 * Priority 1: Qwen3-TTS Flash (qwen-tts) via Pollinations BYOP — 3 attempts, 10s gap
 * Priority 2: Cartesia AI (Fallback)
 */
// ── Voice Profiles per Content Pillar ─────────────────────────────────────
// Via Pollinations Qwen3-TTS Flash (qwen-tts). Valid voices: alloy | echo | fable | onyx | nova | shimmer
// NOTE: 'adam', 'george', 'bella', 'antoni' are ElevenLabs-only and WILL FAIL with qwen-tts.
const PILLAR_VOICE = {
    'Real Life Drama & Betrayal':              'onyx',   // deep, emotional male
    'Real Crime Investigation':                'echo',   // tense, authoritative
    'Real Life Survival Story':                'nova',   // warm, engaging (replaced adam)
    'Historical Mystery or Lost Civilization': 'echo',   // measured, cinematic
    'Psychological Phenomenon or Experiment':  'fable',  // eerie, storytelling
    'Science Anomaly or Space Discovery':      'echo',   // calm authority
    'Conspiracy Theory Deep-Dive (Presented as Investigation)': 'onyx', // deep, serious (replaced adam)
    'Movie / TV Show Plot Breakdown':          'alloy',  // energetic, engaging
};

/**
 * Format narration text for maximum emotional impact:
 * - Insert natural pause markers (". . .") between scenes
 * - Add breath pause after dialogue lines ("I said" / "she said")
 * - Strips SSML (not supported by Pollinations proxy)
 */
function formatNarrationForTTS(blueprint) {
    return blueprint.scenes.map((scene, i) => {
        let text = scene.narration.trim();
        // Add micro-pause at end of each scene using ellipsis
        // (ElevenLabs interprets these as natural breath pauses)
        if (!text.endsWith('...') && !text.endsWith('!') && !text.endsWith('?')) {
            text += '.';
        }
        // Extra pause after dialogue lines for dramatic effect
        if (/i said(?::| )|she said(?::| )|he said(?::| )/i.test(text)) {
            text += '...';
        }
        return text;
    }).join(' ');
}

async function generateVoice(blueprint, customVoice) {
    const scriptText = formatNarrationForTTS(blueprint);
    const outputPath = path.join(__dirname, '../../tmp/audio/voice.mp3');

    console.log(`[AUDIO] 🎙️ Synthesizing narration with ${scriptText.split(' ').length} words...`);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let finalBuffer = null;
    let usedEngine = 'Unknown';

    // ─────────────────────────────────────────────────────────────
    // PRIORITY 1: ElevenLabs via Pollinations BYOP (3 attempts)
    // ─────────────────────────────────────────────────────────────
    const byopKey = process.env.POLLINATIONS_BYOP_KEY;

    // Smart voice: Override with custom voice from UI, else pick based on pillar
    const pillar      = blueprint._pillar || '';
    const chosenVoice = customVoice || PILLAR_VOICE[pillar] || 'nova';

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`[AUDIO] 🔊 Pollinations Qwen3-TTS Flash (voice: ${chosenVoice}) — Attempt ${attempt}/3`);

            const encodedText = encodeURIComponent(scriptText);
            const url = `https://gen.pollinations.ai/audio/${encodedText}?model=qwen-tts&voice=${chosenVoice}`;

            const headers = { 'Accept': 'audio/mpeg, audio/mp3, audio/*, */*' };
            if (byopKey) headers['Authorization'] = `Bearer ${byopKey}`;

            const response = await fetch(url, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(120_000) // 2-min cap
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
            }

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html') || contentType.includes('application/json')) {
                const body = await response.text();
                throw new Error(`Got non-audio response (${contentType}): ${body.slice(0, 200)}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buf = Buffer.from(arrayBuffer);

            if (buf.length < 1024) throw new Error(`Audio too small (${buf.length} bytes) — likely an error payload`);

            finalBuffer = buf;
            usedEngine = `Pollinations/Qwen3-TTS (${chosenVoice})`;
            console.log(`[AUDIO] ✅ Pollinations success on attempt ${attempt} — ${(buf.length / 1024).toFixed(0)}KB`);
            break;

        } catch (err) {
            console.warn(`[AUDIO] ⚠️ Pollinations attempt ${attempt}/3 failed: ${err.message}`);
            if (attempt < 3) {
                console.log(`[AUDIO] ⏳ Waiting 10s before retry...`);
                await sleep(10_000);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // PRIORITY 2: Cartesia Fallback
    // ─────────────────────────────────────────────────────────────
    if (!finalBuffer) {
        console.warn(`[AUDIO] 🔄 All Pollinations attempts exhausted — switching to Cartesia...`);
        usedEngine = 'Cartesia';

        const apiKey = process.env.CARTESIA_API_KEY;
        if (!apiKey) throw new Error('CARTESIA_API_KEY not set and Pollinations also failed. No audio provider available.');

        // Pick voice based on content context
        let voiceId = 'e07c00bc-4134-4eae-9ea4-1a55fb45746b';
        const ctx = ((blueprint.topic || '') + ' ' + (blueprint.core_entity || '') + ' ' + scriptText).toLowerCase();
        if (ctx.includes('history') || ctx.includes('ancient') || ctx.includes('empire') || ctx.includes('war')) {
            voiceId = '79f8b5fb-2cc8-479a-80df-29f7a7cf1a3e';
        }

        console.log(`[AUDIO] 🔊 Cartesia voice: ${voiceId}`);

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await fetch('https://api.cartesia.ai/tts/bytes', {
                    method: 'POST',
                    headers: {
                        'Cartesia-Version': '2024-06-10',
                        'X-API-Key': apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model_id: 'sonic-english',
                        transcript: scriptText,
                        voice: { mode: 'id', id: voiceId },
                        output_format: { container: 'mp3', encoding: 'pcm_f32le', sample_rate: 44100 }
                    }),
                    signal: AbortSignal.timeout(120_000)
                });

                if (!response.ok) {
                    const errText = await response.text().catch(() => '');
                    throw new Error(`Cartesia HTTP ${response.status}: ${errText.slice(0, 200)}`);
                }

                const arrayBuffer = await response.arrayBuffer();
                finalBuffer = Buffer.from(arrayBuffer);
                console.log(`[AUDIO] ✅ Cartesia success — ${(finalBuffer.length / 1024).toFixed(0)}KB`);
                break;

            } catch (err) {
                console.warn(`[AUDIO] ⚠️ Cartesia attempt ${attempt}/3 failed: ${err.message}`);
                if (attempt < 3) await sleep(10_000);
                else throw new Error(`All audio providers exhausted. Last error: ${err.message}`);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // SAVE & MEASURE DURATION
    // ─────────────────────────────────────────────────────────────
    fs.writeFileSync(outputPath, finalBuffer);

    let durationMs;
    try {
        const { spawnSync } = require('child_process');
        const ffprobePath = (() => {
            try {
                const p = require('@ffprobe-installer/ffprobe').path;
                if (p && require('fs').existsSync(p)) return p;
            } catch {}
            return 'ffprobe';
        })();
        const probe = spawnSync(ffprobePath, [
            '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', outputPath
        ], { encoding: 'utf8', timeout: 10000 });
        const measured = parseFloat(probe.stdout.trim());
        if (!isNaN(measured) && measured > 0) {
            durationMs = measured * 1000;
            console.log(`[AUDIO] ⏱️ Duration: ${measured.toFixed(2)}s (ffprobe)`);
        } else {
            throw new Error('ffprobe returned invalid duration');
        }
    } catch (probeErr) {
        const wordCount = scriptText.split(' ').length;
        durationMs = (wordCount / 3.5) * 1000;
        console.warn(`[AUDIO] ⚠️ ffprobe failed. Estimate: ${(durationMs / 1000).toFixed(1)}s`);
    }

    console.log(`[AUDIO] ✅ [${usedEngine}] Audio ready: ${(finalBuffer.length / 1024).toFixed(0)}KB | ${(durationMs / 1000).toFixed(1)}s`);
    return { path: outputPath, durationMs, timestamps: [] };
}

module.exports = { generateVoice };