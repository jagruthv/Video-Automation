'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { getModuleLogger } = require('../utils/logger');
const log = getModuleLogger('supabase-uploader');

// Debug Guard (Action A)
console.log('DEBUG: SUPABASE_URL starts with:', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 8) : 'MISSING');

let supabase;
try {
  // Use standard init for database queries
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: { persistSession: false },
    }
  );
} catch (err) {
  log.error(`FAILED TO INIT SUPABASE CLIENT. CHECK IF URL IN GITHUB SECRETS STARTS WITH HTTPS://.`);
}

/**
 * Upload a finished MP4 to Supabase Storage and register it in the review queue.
 */
async function uploadToStaging(videoPath, metadata) {
  log.info(`Initiating Supabase staging for: ${path.basename(videoPath)}`);

  try {
    if (!fs.existsSync(videoPath)) throw new Error(`Video not found: ${videoPath}`);
    
    // 1. Use fs.promises.readFile(videoPath) to get the buffer
    const fileBuffer = await fs.promises.readFile(videoPath);
    const filename = `${Date.now()}.mp4`;
    const storagePath = `uploads/${filename}`;

    log.info(`📦 Uploading 25MB+ payload to Supabase... Standby. (Path: ${storagePath})`);

    // Action B: Strictly sanitize the secrets
    const cleanUrl = process.env.SUPABASE_URL.trim().replace(/\/$/, '');
    const cleanKey = process.env.SUPABASE_SERVICE_KEY.trim();

    // Action C: Replace fetch() with a Promise-wrapped https.request
    const parsedUrl = new URL(cleanUrl + '/storage/v1/object/aura_videos/' + storagePath);
    log.info(`[DEBUG] Attempting native HTTPS PUT to URL: ${parsedUrl.toString()}`);

    let uploadError = null;
    let success = false;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'PUT',
            headers: {
              'Authorization': 'Bearer ' + cleanKey,
              'Content-Type': 'video/mp4',
              'Content-Length': Buffer.byteLength(fileBuffer),
              'x-upsert': 'true'
            },
            timeout: 120000 // 120 seconds
          };

          const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve();
              } else {
                reject(new Error(`HTTP ${res.statusCode}: ${body}`));
              }
            });
          });

          req.on('error', (e) => reject(e));
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('HTTPS connection timed out after 120s'));
          });

          // Write the buffer directly to the request socket
          req.write(fileBuffer);
          req.end();
        });
        
        success = true;
        break; // Upload passed!
      } catch (err) {
        uploadError = err;
      }
      
      if (!success) {
        log.warn(`Upload attempt ${attempt}/3 failed: ${uploadError?.message}. Retrying...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    if (!success) {
      throw new Error(`Storage upload critically failed after 3 attempts: ${uploadError?.message}`);
    }

    // Action D: Keep the aura_queue database insert using the SDK at the end.
    const { data: urlData } = supabase.storage
      .from('aura_videos')
      .getPublicUrl(storagePath);

    const videoUrl = urlData?.publicUrl;
    if (!videoUrl) throw new Error('Failed to retrieve public URL from Supabase.');

    const queueRow = {
      title: metadata.title || 'Untitled',
      tags: metadata.tags || [],
      video_url: videoUrl,
      status: 'PENDING_REVIEW'
    };

    const { data: insertedRow, error: insertError } = await supabase
      .from('aura_queue')
      .insert(queueRow)
      .select('id')
      .single();

    if (insertError) throw new Error(`Database insert failed: ${insertError.message}`);

    const rowId = insertedRow?.id;
    log.info(`✅ Video successfully staged in aura_queue. Row ID: ${rowId}`);
    
    return rowId;
  } catch (error) {
    log.error(`Staging failed: ${error.message}`);
    throw error;
  }
}

module.exports = { uploadToStaging };
