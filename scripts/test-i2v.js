/**
 * AURA V2 — Offline I2V Test Script
 * 
 * Run: node scripts/test-i2v.js
 * 
 * This generates ONE test image via Pollinations, then sends it to the 
 * free Gradio Lightricks/LTX-Video space and saves the result as test_output.mp4.
 * No HF_TOKEN required for this test — it uses the public Gradio Space.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = path.join(__dirname, '../tmp/i2v_test');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const IMG_PATH   = path.join(OUTPUT_DIR, 'test_base.jpg');
const VIDEO_PATH = path.join(OUTPUT_DIR, 'test_output.mp4');

// A simple test scene
const IMAGE_PROMPT  = 'Wide-angle establishing shot, subject fully visible from a distance, 35mm lens. A massive galleon ship sailing across a calm golden ocean at sunset, dramatic clouds.';
const GLOBAL_ANCHOR = 'hyper-realistic cinematic render, dark golden hour lighting, highly detailed wood and cloth textures';
const GLOBAL_SEED   = 847291;
const MOTION_PROMPT = 'Cinematic slow zoom out, gentle ocean waves, golden light shimmering on the water';


async function downloadFile(url, outputPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`  Downloaded: ${outputPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
}

function downloadBinary(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

async function run() {
  console.log('\n🎨 STEP 1: Generating base image via Pollinations.ai...');
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(IMAGE_PROMPT + ', ' + GLOBAL_ANCHOR)}?width=1080&height=1920&seed=${GLOBAL_SEED}&nologo=true`;
  await downloadFile(url, IMG_PATH);
  console.log('  ✅ Image saved!');

  console.log('\n🎬 STEP 2: Animating image via Lightricks/LTX-Video (Gradio Space)...');
  console.log('  This may take a few minutes on free tier...');

  const { Client, handle_file } = require('@gradio/client');
  const app = await Client.connect('Lightricks/LTX-Video');

  const result = await app.predict('/generate_video_from_image', {
    image: handle_file(IMG_PATH),
    prompt: MOTION_PROMPT,
    negative_prompt: 'blurry, low quality, watermark',
    num_frames: 49,
    frame_rate: 24,
    guidance_scale: 3.0,
    seed: GLOBAL_SEED,
    num_inference_steps: 30,
  });

  const videoUrl = result?.data?.[0]?.url || result?.data?.[0];
  if (!videoUrl) throw new Error(`No video URL in Gradio response: ${JSON.stringify(result?.data)}`);

  console.log(`  Got video URL: ${videoUrl}`);
  await downloadBinary(videoUrl, VIDEO_PATH);

  const sizeMB = (fs.statSync(VIDEO_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ SUCCESS! Output saved to: ${VIDEO_PATH} (${sizeMB} MB)`);
  console.log('🍿 Open the file to preview the animated video!');
}

run().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
