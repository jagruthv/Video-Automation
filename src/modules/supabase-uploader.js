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
  // Use a custom fetch wrapper to inject duplex block and enforce 120s timeout globally
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: { persistSession: false },
      global: {
        fetch: (url, options = {}) => {
          options.duplex = 'half'; // Required for Node 20+ stream/buffer uploads
          options.signal = AbortSignal.timeout(120000); // 120 seconds timeout lock
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

    // 4. Add a log: "📦 Uploading 25MB+ payload to Supabase... Standby."
    log.info(`📦 Uploading 25MB+ payload to Supabase... Standby. (Path: ${storagePath})`);

    // 2. Wrap the storage.from().upload() in a retry loop (3 attempts).
    let uploadError = null;
    let success = false;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error } = await supabase.storage
          .from('aura_videos')
          .upload(storagePath, fileBuffer, { 
            contentType: 'video/mp4', 
            upsert: false,
            // 3. Add duplex: 'half' to the fetch options
            duplex: 'half' 
          });
          
        if (error) {
          uploadError = error;
        } else {
          success = true;
          break; // Upload passed!
        }
      } catch (err) {
        uploadError = err;
      }
      
      if (!success) {
        log.warn(`Upload attempt ${attempt}/3 failed: ${uploadError.message}. Retrying...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    if (!success) {
      throw new Error(`Storage upload critically failed after 3 attempts: ${uploadError.message}`);
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
