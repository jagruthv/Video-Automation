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
const IMAGE_PROMPT  = 'Wide-angle establishing shot, 35mm lens. Galleon ship sailing across a golden ocean at sunset.';
const GLOBAL_ANCHOR = 'cinematic hyper-realistic render, golden hour lighting, highly detailed';
const GLOBAL_SEED   = 847291;
const MOTION_PROMPT = 'Cinematic slow zoom out, gentle ocean waves, golden light shimmering on the water';


function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, { timeout: 90000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.destroy();
        return downloadFile(res.headers.location, outputPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        const size = fs.statSync(outputPath).size;
        console.log(`  Downloaded: ${outputPath} (${(size / 1024).toFixed(0)}KB)`);
        resolve();
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Request timed out')));
  });
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

async function generateImage(outputPath) {
  const fullPrompt = `${IMAGE_PROMPT}, ${GLOBAL_ANCHOR}`;

  // Priority 1: HF Inference API (SDXL)
  const hfToken = process.env.HF_TOKEN;
  if (hfToken) {
    try {
      console.log('  [IMG-1] Trying HF SDXL Inference API...');
      const res = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json', 'X-Wait-For-Model': 'true' },
        body: JSON.stringify({ inputs: fullPrompt, parameters: { width: 768, height: 1344, seed: GLOBAL_SEED, num_inference_steps: 25 } }),
        signal: AbortSignal.timeout(90000),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 10000) {
          fs.writeFileSync(outputPath, buf);
          console.log(`  ✅ HF SDXL succeeded (${(buf.length/1024).toFixed(0)}KB)`);
          return;
        }
      } else {
        console.log(`  HF SDXL returned ${res.status}`);
      }
    } catch(e) { console.log(`  HF SDXL error: ${e.message}`); }
  } else {
    console.log('  [IMG-1] Skipping HF (no HF_TOKEN in .env)');
  }

  // Priority 2: Gradio FLUX.1-schnell (free, no key)
  try {
    console.log('  [IMG-2] Trying Gradio FLUX.1-schnell...');
    const { Client } = require('@gradio/client');
    const app = await Client.connect('black-forest-labs/FLUX.1-schnell', { hf_token: hfToken });
    const result = await app.predict('/infer', {
      prompt: fullPrompt + ', masterpiece, ultra-detailed, 9:16 vertical',
      seed: GLOBAL_SEED, randomize_seed: false,
      width: 768, height: 1344, num_inference_steps: 4,
    });
    const imageUrl = result?.data?.[0]?.url || result?.data?.[0];
    if (!imageUrl) throw new Error('No image URL returned');
    await downloadBinary(imageUrl, outputPath);
    const sz = fs.statSync(outputPath).size;
    if (sz < 10000) throw new Error(`Too small: ${sz}`);
    console.log(`  ✅ FLUX Gradio succeeded (${(sz/1024).toFixed(0)}KB)`);
    return;
  } catch(e) { console.log(`  FLUX Gradio error: ${e.message}`); }

  // Priority 3: Pollinations (fallback)
  console.log('  [IMG-3] Trying Pollinations.ai...');
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1080&height=1920&seed=${GLOBAL_SEED}&nologo=true`;
  await downloadBinary(url, outputPath);
  const sz3 = fs.statSync(outputPath).size;
  if (sz3 < 10000) throw new Error(`Pollinations returned bad image: ${sz3} bytes`);
  console.log(`  ✅ Pollinations succeeded (${(sz3/1024).toFixed(0)}KB)`);
}

async function run() {
  console.log('\n🎨 STEP 1: Generating base image (HF SDXL → FLUX Gradio → Pollinations)...');
  await generateImage(IMG_PATH);
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
