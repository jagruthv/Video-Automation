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
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
} catch (err) {
  log.error(`FAILED TO INIT SUPABASE CLIENT. CHECK IF URL IN GITHUB SECRETS STARTS WITH HTTPS://.`);
}

/**
 * Upload a finished MP4 to Supabase Storage and register it in the review queue.
 */
async function uploadToStaging(videoPath, metadata) {
  log.info(`Initiating Supabase staging for: ${path.basename(videoPath)}`);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Supabase environment variables (URL/KEY) are missing.');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    // Action A: Upload to Storage
    if (!fs.existsSync(videoPath)) throw new Error(`Video not found: ${videoPath}`);
    
    const fileBuffer = fs.readFileSync(videoPath);
    const filename = `${Date.now()}.mp4`;
    const storagePath = `uploads/${filename}`;

    log.info(`Uploading file to bucket 'aura_videos' as '${storagePath}'...`);

    const { error: uploadError } = await supabase.storage
      .from('aura_videos')
      .upload(storagePath, fileBuffer, { contentType: 'video/mp4', upsert: false });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    // Action B: Retrieve Public URL
    const { data: urlData } = supabase.storage
      .from('aura_videos')
      .getPublicUrl(storagePath);

    const videoUrl = urlData?.publicUrl;
    if (!videoUrl) throw new Error('Failed to retrieve public URL from Supabase.');

    // Action C: Insert into aurq_queue table
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
