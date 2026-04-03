'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { getModuleLogger } = require('../utils/logger');
const log = getModuleLogger('supabase-uploader');

// Debug Guard (Action A)
console.log('DEBUG: SUPABASE_URL starts with:', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 8) : 'MISSING');

let supabase;
try {
  // Use a standard fetch wrapper for regular DB operations
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: { persistSession: false },
      global: {
        fetch: (url, options = {}) => {
          options.duplex = 'half'; // Required for Node 20+ stream/buffer
          options.signal = AbortSignal.timeout(120000); 
          return fetch(url, options);
        }
      }
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

    // REST API Endpoint specifically bypassing SDK bugs
    const uploadUrl = `${process.env.SUPABASE_URL}/storage/v1/object/aura_videos/${storagePath}`;
    
    // Debug log to print the entire URL it's trying to hit
    log.info(`[DEBUG] Attempting REST PUT to URL: ${uploadUrl}`);

    // Wrap the REST upload in a retry loop (3 attempts)
    let uploadError = null;
    let success = false;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST', // Supabase requires POST or PUT depending on endpoints, but storage insert is typically POST to upload, HTTP PUT for standard object insert
          // Wait, user specified: "use a standard fetch() PUT request to the Supabase REST endpoint"
          method: 'PUT',
          headers: {
            'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
            'Content-Type': 'video/mp4',
            'x-upsert': 'true'
          },
          body: fileBuffer,
          duplex: 'half', // Keeps Node 20 safe
          signal: AbortSignal.timeout(120000)
        });

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          uploadError = new Error(`HTTP ${uploadRes.status}: ${errText}`);
        } else {
          success = true;
          break; // Upload passed!
        }
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

    // Action B: Retrieve Public URL
    const { data: urlData } = supabase.storage
      .from('aura_videos')
      .getPublicUrl(storagePath);

    const videoUrl = urlData?.publicUrl;
    if (!videoUrl) throw new Error('Failed to retrieve public URL from Supabase.');

    // Action C: Insert into aura_queue table
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
