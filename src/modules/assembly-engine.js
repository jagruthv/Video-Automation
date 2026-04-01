'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const { getModuleLogger } = require('../utils/logger');

const log = getModuleLogger('assembly-engine');

const FFMPEG_TIMEOUT = 120000; // 2 minutes per FFmpeg command

/**
 * Execute an FFmpeg command with timeout.
 * @param {string} cmd
 * @param {string} description
 * @returns {Promise<void>}
 */
function runFFmpeg(cmd, description = '') {
  return new Promise((resolve, reject) => {
    const label = description || cmd.substring(0, 80);
    log.info(`FFmpeg: ${label}`);
    const proc = exec(cmd, { timeout: FFMPEG_TIMEOUT, maxBuffer: 10 * 1024 * 1024 });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.substring(0, 500)}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Check if FFmpeg is available, attempt install if not.
 * @returns {Promise<boolean>}
 */
async function ensureFFmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    log.warn('FFmpeg not found, attempting install...');
    try {
      execSync('apt-get update && apt-get install -y ffmpeg', { stdio: 'pipe', timeout: 60000 });
      return true;
    } catch (err) {
      log.error(`FFmpeg install failed: ${err.message}`);
      return false;
    }
  }
}

/**
 * Generate ASS subtitle file with word-by-word highlighting.
 * Groups words into chunks of 3, highlights current word in yellow.
 *
 * @param {Array<{word: string, startMs: number, endMs: number}>} wordTimestamps
 * @param {string} outputPath
 */
function generateASSFile(wordTimestamps, outputPath) {
  const header = `[Script Info]
Title: AURA Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,56,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,30,30,350,1
Style: Highlight,Arial,58,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,30,30,350,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];
  const chunkSize = 3;
  const filteredWords = wordTimestamps.filter(w => w.word && w.word.trim().length > 0);

  for (let i = 0; i < filteredWords.length; i += chunkSize) {
    const chunk = filteredWords.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;

    const chunkStart = chunk[0].startMs;
    const chunkEnd = chunk[chunk.length - 1].endMs;

    // For each word position in the chunk, create a dialogue line
    for (let w = 0; w < chunk.length; w++) {
      const wordStart = chunk[w].startMs;
      const wordEnd = w < chunk.length - 1 ? chunk[w + 1].startMs : chunkEnd;

      // Build text with current word highlighted
      const parts = chunk.map((cw, ci) => {
        const cleanWord = cw.word.replace(/[{}\\]/g, '');
        if (ci === w) {
          return `{\\c&H0000FFFF&\\b1}${cleanWord}{\\c&H00FFFFFF&\\b0}`;
        }
        return cleanWord;
      });

      const startTime = formatASSTime(wordStart);
      const endTime = formatASSTime(wordEnd);
      events.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${parts.join(' ')}`);
    }
  }

  const content = header + events.join('\n') + '\n';
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, content);
  log.info(`ASS subtitle file generated: ${events.length} events`);
}

/**
 * Format milliseconds to ASS time format (H:MM:SS.cc)
 * @param {number} ms
 * @returns {string}
 */
function formatASSTime(ms) {
  const totalSeconds = ms / 1000;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const cs = Math.round((totalSeconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Assemble final video from audio, visuals, and subtitles.
 *
 * Pipeline:
 * 1. Normalize audio to -14 LUFS
 * 2. Prepare background (concatenate clips or Ken Burns on images)
 * 3. Add subtle ambient noise (anti-fingerprint)
 * 4. Burn subtitles and merge
 * 5. Validate output
 *
 * @param {string} audioPath - Path to voice audio
 * @param {Array} visualClips - [{path, durationMs, type: 'video'|'image', loop}]
 * @param {Array} wordTimestamps - [{word, startMs, endMs}]
 * @param {Object} options
 * @returns {Promise<{videoPath: string, durationSeconds: number, fileSizeMB: number}>}
 */
async function assembleVideo(audioPath, visualClips, wordTimestamps, options = {}) {
  const hasFfmpeg = await ensureFFmpeg();
  if (!hasFfmpeg) throw new Error('FFmpeg is not available');

  const buildDir = '/tmp/build';
  const outputDir = path.join(buildDir, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const audioNorm = path.join(buildDir, 'audio', 'voice_norm.mp3');
  const bgPrepared = path.join(buildDir, 'bg_prepared.mp4');
  const mixedAudio = path.join(buildDir, 'audio', 'mixed_audio.mp3');
  const subsFile = path.join(buildDir, 'subtitles.ass');
  const finalOutput = path.join(outputDir, `aura_${Date.now()}.mp4`);

  try {
    // STEP 1: Normalize audio to YouTube standard (-14 LUFS)
    log.info('Step 1: Normalizing audio...');
    await runFFmpeg(
      `ffmpeg -y -i "${audioPath}" -af "loudnorm=I=-14:LRA=11:TP=-1.5" -ar 48000 -ac 1 "${audioNorm}"`,
      'Normalize audio'
    );

    // Get audio duration
    const durationStr = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioNorm}"`,
      { encoding: 'utf8' }
    ).trim();
    const audioDuration = parseFloat(durationStr);
    log.info(`Audio duration: ${audioDuration.toFixed(1)}s`);

    // STEP 2: Prepare background video
    log.info('Step 2: Preparing background visuals...');
    if (visualClips.length === 0) {
      throw new Error('No visual clips provided');
    }

    const firstClip = visualClips[0];
    if (firstClip.type === 'video') {
      // For video clips: loop and scale to 1080x1920
      await runFFmpeg(
        `ffmpeg -y -stream_loop -1 -i "${firstClip.path}" -t ${audioDuration} ` +
        `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1" ` +
        `-c:v libx264 -preset fast -pix_fmt yuv420p -r 30 "${bgPrepared}"`,
        'Prepare background video'
      );
    } else {
      // For images: Ken Burns effect (slow zoom/pan)
      await runFFmpeg(
        `ffmpeg -y -loop 1 -i "${firstClip.path}" -t ${audioDuration} ` +
        `-vf "scale=1200:2140,zoompan=z='min(zoom+0.0008,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(audioDuration * 30)}:s=1080x1920:fps=30,setsar=1" ` +
        `-c:v libx264 -preset fast -pix_fmt yuv420p "${bgPrepared}"`,
        'Ken Burns effect on image'
      );
    }

    // STEP 3: Mix ambient noise (anti-fingerprint)
    log.info('Step 3: Mixing audio...');
    const ambientDir = path.join(__dirname, '../../assets/ambient');
    const ambientFiles = fs.existsSync(ambientDir) ? fs.readdirSync(ambientDir).filter(f => f.endsWith('.mp3')) : [];

    if (ambientFiles.length > 0 && options.addAmbientNoise !== false) {
      const randomAmbient = path.join(ambientDir, ambientFiles[Math.floor(Math.random() * ambientFiles.length)]);
      await runFFmpeg(
        `ffmpeg -y -i "${audioNorm}" -i "${randomAmbient}" ` +
        `-filter_complex "[1]volume=0.03,aloop=loop=-1:size=2e+09[amb];[0][amb]amix=inputs=2:duration=first:dropout_transition=2" ` +
        `"${mixedAudio}"`,
        'Mix ambient noise'
      );
    } else {
      // No ambient files — just copy normalized audio
      fs.copyFileSync(audioNorm, mixedAudio);
      log.info('No ambient files found — using clean audio');
    }

    // STEP 4: Generate ASS subtitles
    log.info('Step 4: Generating subtitles...');
    if (wordTimestamps && wordTimestamps.length > 0) {
      generateASSFile(wordTimestamps, subsFile);
    }

    // STEP 5: Final assembly — merge video + audio + subtitles
    log.info('Step 5: Final assembly...');
    const subsFilter = fs.existsSync(subsFile) ? `,ass=${subsFile.replace(/\\/g, '/')}` : '';
    await runFFmpeg(
      `ffmpeg -y -i "${bgPrepared}" -i "${mixedAudio}" ` +
      `-vf "fps=30${subsFilter}" ` +
      `-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ` +
      `-shortest -movflags +faststart -t 59 "${finalOutput}"`,
      'Final video assembly'
    );

    // STEP 6: Validate output
    log.info('Step 6: Validating output...');
    if (!fs.existsSync(finalOutput)) throw new Error('Output file does not exist');

    const stat = fs.statSync(finalOutput);
    if (stat.size < 100 * 1024) throw new Error(`Output too small: ${stat.size} bytes`);

    const outDuration = parseFloat(execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalOutput}"`,
      { encoding: 'utf8' }
    ).trim());

    if (outDuration < 10 || outDuration > 60) {
      log.warn(`Output duration ${outDuration}s is outside 10-60s range`);
    }

    const fileSizeMB = stat.size / (1024 * 1024);
    log.info(`Video assembled: ${finalOutput} (${outDuration.toFixed(1)}s, ${fileSizeMB.toFixed(1)}MB)`);

    // Clean up intermediate files
    for (const f of [audioNorm, bgPrepared, mixedAudio, subsFile]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }

    return {
      videoPath: finalOutput,
      durationSeconds: Math.round(outDuration),
      fileSizeMB: Math.round(fileSizeMB * 10) / 10
    };
  } catch (err) {
    log.error(`Assembly failed: ${err.message}`);

    // Fallback: try simpler assembly without subtitles
    if (!err.message.includes('fallback')) {
      log.info('Attempting fallback assembly without subtitles...');
      try {
        const fallbackOutput = path.join(outputDir, `aura_fallback_${Date.now()}.mp4`);
        const clip = visualClips[0];
        const inputFlag = clip.type === 'video' ? `-stream_loop -1 -i "${clip.path}"` : `-loop 1 -i "${clip.path}"`;
        const durationStr2 = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
          { encoding: 'utf8' }
        ).trim();

        await runFFmpeg(
          `ffmpeg -y ${inputFlag} -i "${audioPath}" ` +
          `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" ` +
          `-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ` +
          `-shortest -movflags +faststart -t 59 "${fallbackOutput}"`,
          'fallback assembly'
        );

        const fStat = fs.statSync(fallbackOutput);
        return {
          videoPath: fallbackOutput,
          durationSeconds: Math.round(parseFloat(durationStr2)),
          fileSizeMB: Math.round(fStat.size / (1024 * 1024) * 10) / 10
        };
      } catch (fbErr) {
        throw new Error(`Assembly and fallback both failed: ${fbErr.message}`);
      }
    }
    throw err;
  }
}

module.exports = { assembleVideo, generateASSFile };
