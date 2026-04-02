'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const { getModuleLogger } = require('../utils/logger');

const log = getModuleLogger('assembly-engine');

const FFMPEG_TIMEOUT = 180000; // 3 minutes

// ============================================================
// FFmpeg Effect Dictionary (LLM-controlled "AI Director")
// Maps effect names to zoompan/color filter strings.
// The placeholder {{D}} is replaced with the per-image duration in frames.
// ============================================================
const EFFECT_FILTERS = {
  zoom_in:        (frames) => `zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30`,
  pan_right:      (frames) => `zoompan=z='1.15':x='min(x+2,iw*0.15)':y='0':d=${frames}:s=1080x1920:fps=30`,
  cyberpunk_color:(frames) => `zoompan=z='1.05':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,eq=contrast=1.2:saturation=1.5:gamma_b=0.9`,
  bw_hacker:      (frames) => `zoompan=z='min(zoom+0.001,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,hue=s=0`,
  glitch:         (frames) => `zoompan=z='1.1':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,noise=alls=8:allf=t+u`
};

const VALID_EFFECTS = Object.keys(EFFECT_FILTERS);

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

/**
 * Generate ASS subtitle file with word-by-word karaoke highlighting.
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
    if (!chunk.length) continue;
    const chunkStart = chunk[0].startMs;
    const chunkEnd = chunk[chunk.length - 1].endMs;
    for (let w = 0; w < chunk.length; w++) {
      const wordStart = chunk[w].startMs;
      const wordEnd = w < chunk.length - 1 ? chunk[w + 1].startMs : chunkEnd;
      const parts = chunk.map((cw, ci) => {
        const clean = cw.word.replace(/[{}\\]/g, '');
        return ci === w ? `{\\c&H0000FFFF&\\b1}${clean}{\\c&H00FFFFFF&\\b0}` : clean;
      });
      events.push(`Dialogue: 0,${formatASSTime(wordStart)},${formatASSTime(wordEnd)},Default,,0,0,0,,${parts.join(' ')}`);
    }
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, header + events.join('\n') + '\n');
  log.info(`ASS subtitles: ${events.length} events generated`);
}

function formatASSTime(ms) {
  const t = ms / 1000;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '00')}`;
}

/**
 * Assemble final video from 3 AI-generated images with LLM-directed effects and xfade transitions.
 *
 * Pipeline:
 * 1. Normalize audio to -14 LUFS
 * 2. For each image, apply the LLM-chosen FFmpeg effect (zoom/color/glitch)
 * 3. Crossfade the 3 image clips together with 1s xfade transitions
 * 4. Burn word-karaoke subtitles
 * 5. Merge with audio and validate
 *
 * @param {string} audioPath
 * @param {Array} visualClips - [{path, type:'image', effect, durationMs}]
 * @param {Array} wordTimestamps
 * @param {Object} options
 * @returns {Promise<{videoPath, durationSeconds, fileSizeMB}>}
 */
async function assembleVideo(audioPath, visualClips, wordTimestamps, options = {}) {
  const hasFfmpeg = await ensureFFmpeg();
  if (!hasFfmpeg) throw new Error('FFmpeg is not available');

  const buildDir = '/tmp/build';
  const outputDir = path.join(buildDir, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const audioNorm   = path.join(buildDir, 'audio', 'voice_norm.mp3');
  const audioMixed  = path.join(buildDir, 'audio', 'mixed_audio.mp3');
  const bgVideo     = path.join(buildDir, 'bg_prepared.mp4');
  const subsFile    = path.join(buildDir, 'subtitles.ass');
  const finalOutput = path.join(outputDir, `aura_${Date.now()}.mp4`);

  // STEP 1: Normalize audio
  log.info('Step 1: Normalizing audio...');
  await runFFmpeg(
    `ffmpeg -y -i "${audioPath}" -af "loudnorm=I=-14:LRA=11:TP=-1.5" -ar 48000 -ac 1 "${audioNorm}"`,
    'Normalize audio'
  );

  const audioDuration = parseFloat(execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioNorm}"`,
    { encoding: 'utf8' }
  ).trim());
  log.info(`Audio duration: ${audioDuration.toFixed(1)}s`);

  // STEP 2: Build the AI Director video — 3 images with effects + xfade crossfades
  log.info('Step 2: Assembling AI-directed visual sequence...');

  const XFADE_DUR = 1; // 1 second crossfade between images
  const numImages = Math.min(visualClips.length, 3);
  const durationPerImage = audioDuration / numImages;
  const frames = Math.round(durationPerImage * 30); // 30fps

  // Validate we have image clips
  if (numImages === 0) throw new Error('No visual clips provided to assembler');

  try {
    if (numImages === 1) {
      // Only one image — just apply effect + loop to fill duration
      const clip = visualClips[0];
      const effectName = VALID_EFFECTS.includes(clip.effect) ? clip.effect : 'zoom_in';
      const filterStr = EFFECT_FILTERS[effectName](frames * numImages);
      await runFFmpeg(
        `ffmpeg -y -loop 1 -i "${clip.path}" -t ${audioDuration} ` +
        `-vf "scale=1200:2140,${filterStr},setsar=1" ` +
        `-c:v libx264 -preset fast -pix_fmt yuv420p "${bgVideo}"`,
        `Single image with ${effectName} effect`
      );
    } else {
      // Build individual effect clips for each image, then xfade-chain them
      const segmentPaths = [];
      for (let i = 0; i < numImages; i++) {
        const clip = visualClips[i];
        const effectName = VALID_EFFECTS.includes(clip.effect) ? clip.effect : 'zoom_in';
        const segDuration = i < numImages - 1 ? durationPerImage : audioDuration - (durationPerImage * (numImages - 1));
        const segFrames = Math.round(segDuration * 30);
        const segPath = path.join(buildDir, `seg_${i}.mp4`);

        const filterStr = EFFECT_FILTERS[effectName](segFrames);
        await runFFmpeg(
          `ffmpeg -y -loop 1 -i "${clip.path}" -t ${segDuration + XFADE_DUR} ` +
          `-vf "scale=1200:2140,${filterStr},setsar=1" ` +
          `-c:v libx264 -preset fast -pix_fmt yuv420p "${segPath}"`,
          `Image ${i + 1}/${numImages}: ${effectName} effect`
        );
        segmentPaths.push(segPath);
      }

      // Chain xfade transitions: seg0 -> xfade -> seg1 -> xfade -> seg2
      // xfade offset = cumulative duration of previous segments minus overlap
      let inputs = segmentPaths.map(p => `-i "${p}"`).join(' ');
      let filterComplex = '';
      let lastOutput = '[0:v]';

      for (let i = 1; i < numImages; i++) {
        const offset = (durationPerImage * i) - (XFADE_DUR * (i - 1)) - XFADE_DUR;
        const outLabel = i < numImages - 1 ? `[xf${i}]` : '[vout]';
        filterComplex += `${lastOutput}[${i}:v]xfade=transition=fade:duration=${XFADE_DUR}:offset=${Math.max(0, offset).toFixed(2)}${outLabel};`;
        lastOutput = outLabel;
      }
      // Remove trailing semicolon
      filterComplex = filterComplex.replace(/;$/, '');

      await runFFmpeg(
        `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[vout]" ` +
        `-t ${audioDuration} -c:v libx264 -preset fast -pix_fmt yuv420p "${bgVideo}"`,
        'Crossfade transition stitching'
      );

      // Cleanup segment files
      for (const sp of segmentPaths) {
        try { fs.unlinkSync(sp); } catch {}
      }
    }
  } catch (err) {
    log.warn(`Cinematic assembly failed, falling back to basic concatenation. Error: ${err.message}`);
    
    // The Bulletproof Fallback
    if (visualClips.length >= 3) {
      const inputs = visualClips.slice(0, 3).map(c => `-loop 1 -t ${durationPerImage} -i "${c.path}"`).join(' ');
      const filterComplex = 
        `[0:v]scale=1080:1920,setsar=1[v0];` +
        `[1:v]scale=1080:1920,setsar=1[v1];` +
        `[2:v]scale=1080:1920,setsar=1[v2];` +
        `[v0][v1][v2]concat=n=3:v=1:a=0[outv]`;
        
      await runFFmpeg(
        `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[outv]" ` +
        `-t ${audioDuration} -c:v libx264 -preset fast -pix_fmt yuv420p "${bgVideo}"`,
        'Fallback concat 3 images'
      );
    } else {
      const clip = visualClips[0];
      await runFFmpeg(
        `ffmpeg -y -loop 1 -i "${clip.path}" -t ${audioDuration} ` +
        `-vf "scale=1080:1920,setsar=1" ` +
        `-c:v libx264 -preset fast -pix_fmt yuv420p "${bgVideo}"`,
        'Fallback basic single image'
      );
    }
  }

  // STEP 3: Mix ambient noise (anti-fingerprint)
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
    log.info('No ambient files — using clean audio');
  }

  // STEP 4: Generate subtitles
  log.info('Step 4: Generating subtitles...');
  if (wordTimestamps && wordTimestamps.length > 0) {
    generateASSFile(wordTimestamps, subsFile);
  }

  // STEP 5: Final merge — video + audio + burned subtitles
  log.info('Step 5: Final assembly...');
  const subsFilter = fs.existsSync(subsFile) ? `,ass=${subsFile.replace(/\\/g, '/')}` : '';
  await runFFmpeg(
    `ffmpeg -y -i "${bgVideo}" -i "${audioMixed}" ` +
    `-vf "fps=30${subsFilter}" ` +
    `-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ` +
    `-shortest -movflags +faststart -t 59 "${finalOutput}"`,
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

  if (outDuration < 10 || outDuration > 60) {
    log.warn(`Output duration ${outDuration}s is outside expected 10-60s range`);
  }

  const fileSizeMB = stat.size / (1024 * 1024);
  log.info(`✅ Video assembled: ${finalOutput} (${outDuration.toFixed(1)}s, ${fileSizeMB.toFixed(1)}MB)`);

  // Cleanup intermediates
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
