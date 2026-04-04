'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const { getModuleLogger } = require('../utils/logger');

const log = getModuleLogger('assembly-engine');

const FFMPEG_TIMEOUT = 300000; // 5 minutes (xfade chains are heavy)
const XFADE_DURATION = 0.5;   // 0.5-second crossfade between every clip

// ============================================================
// FFmpeg Runner
// ============================================================
function runFFmpeg(cmd, description = '') {
  return new Promise((resolve, reject) => {
    log.info(`FFmpeg: ${description || cmd.substring(0, 100)}...`);
    const proc = exec(cmd, { timeout: FFMPEG_TIMEOUT, maxBuffer: 10 * 1024 * 1024 });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.substring(0, 600)}`));
    });
    proc.on('error', reject);
  });
}

async function ensureFFmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    log.warn('FFmpeg not found, attempting install...');
    try {
      execSync('apt-get update && apt-get install -y ffmpeg', { stdio: 'pipe', timeout: 120000 });
      return true;
    } catch (err) {
      log.error(`FFmpeg install failed: ${err.message}`);
      return false;
    }
  }
}

// ============================================================
// ASS SUBTITLE GENERATOR
// Zack D. Films style: Center screen, bold font, 
// alternating yellow/white per word, thick black border.
// ============================================================
function generateASSFile(wordTimestamps, outputPath) {
  // Alignment 5 = center screen (both horizontally and vertically centered)
  const header = `[Script Info]
Title: AURA Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Arial Black,76,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,5,2,5,40,40,960,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];
  const filteredWords = wordTimestamps.filter(w => w.word && w.word.trim().length > 0);

  // Show 3 words at a time. The active word is highlighted yellow, the rest stay white.
  // This creates a smooth, professional retention editing style without exhausting flickering.
  const chunkSize = 3;
  for (let i = 0; i < filteredWords.length; i += chunkSize) {
    const chunk = filteredWords.slice(i, i + chunkSize);
    if (!chunk.length) continue;

    const chunkEnd = chunk[chunk.length - 1].endMs;

    // Highlight each word sequentially over the chunk's total screen time
    for (let w = 0; w < chunk.length; w++) {
      const wordStart = chunk[w].startMs;
      const wordEnd = w < chunk.length - 1 ? chunk[w + 1].startMs : chunkEnd;
      
      let textLine = '';
      for (let j = 0; j < chunk.length; j++) {
         const cleanWord = chunk[j].word;
         if (j === w) {
             textLine += `{\\c&H00FFFF&}${cleanWord}{\\c&HFFFFFF&} `; // Yellow highlight
         } else {
             textLine += `${cleanWord} `; // White context
         }
      }
      textLine = textLine.trim();

      // Only pop the entire block when it first appears.
      const popAnim = w === 0 ? `{\\fscx110\\fscy110\\t(0,100,\\fscx100\\fscy100)}` : '';
      
      events.push(
        `Dialogue: 0,${formatASSTime(wordStart)},${formatASSTime(wordEnd)},Main,,0,0,0,,${popAnim}${textLine}`
      );
    }
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, header + events.join('\n') + '\n');
  log.info(`ASS subtitles: ${events.length} events generated (Smart Chunking, 3 words/screen)`);
}

function formatASSTime(ms) {
  const t = ms / 1000;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '00')}`;
}

// ============================================================
// XFADE CHAIN BUILDER
// Builds a complex FFmpeg filtergraph that crossfades N clips 
// together seamlessly using the xfade filter.
// Each transition = 0.5s overlap, blending visually.
// ============================================================
function buildXfadeFiltergraph(segmentPaths, xfadeDuration) {
  const n = segmentPaths.length;
  if (n === 1) return { inputs: `-i "${segmentPaths[0]}"`, filtergraph: null, finalLabel: '0:v' };

  const inputs = segmentPaths.map(p => `-i "${p}"`).join(' ');
  const filters = [];
  let prevLabel = '[0:v]';
  let offsetAccum = 0;

  // Get durations of each segment to compute xfade offsets
  const durations = segmentPaths.map(p => {
    try {
      return parseFloat(execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}"`,
        { encoding: 'utf8' }
      ).trim());
    } catch { return 6; } // fallback 6s
  });

  for (let i = 1; i < n; i++) {
    const nextLabel = `[v${i}]`;
    const inputLabel = `[${i}:v]`;
    // offset = sum of all previous clip durations minus cumulative xfade overlaps
    offsetAccum += durations[i - 1] - xfadeDuration;
    const outLabel = i === n - 1 ? '[vout]' : nextLabel;
    filters.push(
      `${prevLabel}${inputLabel}xfade=transition=smoothleft:duration=${xfadeDuration}:offset=${offsetAccum.toFixed(3)}${outLabel}`
    );
    prevLabel = nextLabel;
  }

  return {
    inputs,
    filtergraph: filters.join(';'),
    finalLabel: '[vout]'
  };
}

// ============================================================
// MAIN ASSEMBLY — The Seamless Stitcher
// ============================================================
async function assembleVideo(audioPath, visualClips, wordTimestamps, options = {}) {
  const hasFfmpeg = await ensureFFmpeg();
  if (!hasFfmpeg) throw new Error('FFmpeg is not available');

  const buildDir = '/tmp/build';
  const outputDir = path.join(buildDir, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const audioNorm  = path.join(buildDir, 'audio', 'voice_norm.mp3');
  const audioMixed = path.join(buildDir, 'audio', 'mixed_audio.mp3');
  const bgVideo    = path.join(buildDir, 'bg_prepared.mp4');
  const subsFile   = path.join(buildDir, 'subtitles.ass');
  const finalOutput = path.join(outputDir, `aura_${Date.now()}.mp4`);

  // STEP 1: Normalize audio
  log.info('Step 1: Normalizing audio (1s tail silence)...');
  await runFFmpeg(
    `ffmpeg -y -i "${audioPath}" -af "loudnorm=I=-14:LRA=11:TP=-1.5,apad=pad_dur=1" -ar 48000 -ac 1 "${audioNorm}"`,
    'Normalize audio'
  );

  const audioDuration = parseFloat(execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioNorm}"`,
    { encoding: 'utf8' }
  ).trim());
  log.info(`Audio duration: ${audioDuration.toFixed(1)}s`);

  if (visualClips.length === 0) throw new Error('No visual clips provided to assembler');

  // STEP 2: Standardize all clips to identical 1080x1920 @ 30fps segments
  log.info('Step 2: Standardizing all clips to 1080x1920 @ 30fps...');
  const durationPerClip = audioDuration / visualClips.length;
  const segmentPaths = [];

  for (let i = 0; i < visualClips.length; i++) {
    const clip = visualClips[i];
    const segPath = path.join(buildDir, `scene_std_${i}.mp4`);
    const frames = Math.round(durationPerClip * 30);

    if (clip.type === 'image') {
      await runFFmpeg(
        `ffmpeg -y -loop 1 -i "${clip.path}" -t ${durationPerClip} ` +
        `-vf "scale=1200:2140,zoompan=z='1.05':x='min(x+1,iw*0.1)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,setsar=1" ` +
        `-c:v libx264 -preset fast -pix_fmt yuv420p "${segPath}"`,
        `Standardising Image ${i + 1}/${visualClips.length} (pan right)`
      );
    } else {
      await runFFmpeg(
        `ffmpeg -y -stream_loop -1 -i "${clip.path}" -t ${durationPerClip} ` +
        `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30" ` +
        `-c:v libx264 -preset fast -pix_fmt yuv420p -an "${segPath}"`,
        `Standardising Video ${i + 1}/${visualClips.length}`
      );
    }
    segmentPaths.push(segPath);
  }

  // STEP 2.5: Crossfade xfade stitch (replacing hard-cut concat)
  if (segmentPaths.length === 1) {
    fs.copyFileSync(segmentPaths[0], bgVideo);
    log.info('Step 2.5: Single clip — no xfade needed.');
  } else {
    log.info(`Step 2.5: Stitching ${segmentPaths.length} clips with ${XFADE_DURATION}s xfade crossfades...`);
    const { inputs, filtergraph, finalLabel } = buildXfadeFiltergraph(segmentPaths, XFADE_DURATION);

    await runFFmpeg(
      `ffmpeg -y ${inputs} -filter_complex "${filtergraph}" -map "${finalLabel}" ` +
      `-c:v libx264 -preset fast -pix_fmt yuv420p "${bgVideo}"`,
      `XFade crossfade stitch (${segmentPaths.length} clips)`
    );
  }

  segmentPaths.forEach(sp => { try { fs.unlinkSync(sp); } catch {} });

  // STEP 3: Mix ambient audio (optional)
  log.info('Step 3: Mixing audio...');
  const ambientDir = path.join(__dirname, '../../assets/ambient');
  const ambientFiles = fs.existsSync(ambientDir)
    ? fs.readdirSync(ambientDir).filter(f => f.endsWith('.mp3'))
    : [];

  if (ambientFiles.length > 0 && options.addAmbientNoise !== false) {
    const randomAmbient = path.join(ambientDir, ambientFiles[Math.floor(Math.random() * ambientFiles.length)]);
    await runFFmpeg(
      `ffmpeg -y -i "${audioNorm}" -i "${randomAmbient}" ` +
      `-filter_complex "[1]volume=0.03,aloop=loop=-1:size=2e+09[amb];[0][amb]amix=inputs=2:duration=first:dropout_transition=2" ` +
      `"${audioMixed}"`,
      'Mix ambient noise'
    );
  } else {
    fs.copyFileSync(audioNorm, audioMixed);
  }

  // STEP 4: Generate center-screen subtitles (alternating yellow/white, pop animation)
  log.info('Step 4: Generating center-screen subtitles...');
  if (wordTimestamps && wordTimestamps.length > 0) {
    generateASSFile(wordTimestamps, subsFile);
  }

  // STEP 5: Final assembly with audio fade-out
  log.info('Step 5: Final assembly (audio fade-out + subtitle burn)...');
  const subsFilter = fs.existsSync(subsFile) ? `,ass=${subsFile.replace(/\\/g, '/')}` : '';
  const fadeOutStart = Math.max(0, audioDuration - 2).toFixed(1);
  await runFFmpeg(
    `ffmpeg -y -i "${bgVideo}" -i "${audioMixed}" ` +
    `-map 0:v:0 -map 1:a:0 ` +
    `-vf "fps=30${subsFilter}" ` +
    `-af "afade=t=out:st=${fadeOutStart}:d=1.5" ` +
    `-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ` +
    `-shortest -movflags +faststart "${finalOutput}"`,
    'Final video assembly'
  );

  // STEP 6: Validate
  log.info('Step 6: Validating output...');
  if (!fs.existsSync(finalOutput)) throw new Error('Output file does not exist after assembly');
  const stat = fs.statSync(finalOutput);
  if (stat.size < 100 * 1024) throw new Error(`Output too small: ${stat.size} bytes`);

  const outDuration = parseFloat(execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalOutput}"`,
    { encoding: 'utf8' }
  ).trim());

  if (outDuration < 10 || outDuration > 65) {
    log.warn(`Output duration ${outDuration}s is outside expected 10-65s range`);
  }

  const fileSizeMB = stat.size / (1024 * 1024);
  log.info(`✅ Video assembled: ${finalOutput} (${outDuration.toFixed(1)}s, ${fileSizeMB.toFixed(1)}MB)`);

  for (const f of [audioNorm, bgVideo, audioMixed, subsFile]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }

  return {
    videoPath: finalOutput,
    durationSeconds: Math.round(outDuration),
    fileSizeMB: Math.round(fileSizeMB * 10) / 10
  };
}

module.exports = { assembleVideo, generateASSFile };
