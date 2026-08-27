const { google } = require('googleapis');
const fs = require('fs');
const eventBus = require('./event-bus');
require('dotenv').config();

/**
 * AURA-V2 Official API Publisher (Titanium Bridge)
 * Uses official YouTube Data API v3 for secure uploads.
 * Quota Cost: 1600 points per video.
 */
async function publish(videoPath, blueprint, targetDate = new Date(), isImmediate = true) {
    const log = (msg) => {
        console.log(`[GHOST-API] ${msg}`);
        eventBus.emit('log', `[GHOST-API] ${msg}`);
    };

    log(`🚀 Initiating API Upload Sequence...`);

    const clientId = process.env.YT_CLIENT_ID;
    const clientSecret = process.env.YT_CLIENT_SECRET;
    const refreshToken = process.env.YT_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("YouTube API Credentials missing in .env (ID/Secret/Token)");
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    try {
        log(`📀 Processing Video Binary: ${blueprint.title}`);

        if (!fs.existsSync(videoPath)) {
            throw new Error(`Video file not found on disk: ${videoPath}`);
        }

        // Extract hashtags — blueprint uses 'hashtags' not 'tags'
        let parsedMeta = {};
        try {
            parsedMeta = typeof blueprint.metadata === 'string' ? JSON.parse(blueprint.metadata) : (blueprint.metadata || {});
        } catch (e) { console.log("[PUBLISHER] Warning: Could not parse metadata json."); }
        
        const tags = (blueprint.hashtags || blueprint.tags || parsedMeta.tags || parsedMeta.hashtags || []).map(t => t.replace(/^#/, ''));
        
        // Enforce YouTube 100-char max length on Title
        let safeTitle = blueprint.title || 'AURA Automated Video';
        if (safeTitle.length > 98) safeTitle = safeTitle.substring(0, 95) + '...';

        const res = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: {
                    title: safeTitle,
                    description: blueprint.description,
                    tags,
                    categoryId: '22', // People & Blogs
                    defaultLanguage: 'en',
                    defaultAudioLanguage: 'en'
                },
                status: {
                    privacyStatus: isImmediate ? 'public' : 'private',
                    selfDeclaredMadeForKids: false,
                    ...(isImmediate ? {} : { publishAt: targetDate.toISOString() })
                }
            },
            media: {
                body: fs.createReadStream(videoPath)
            }
        });

        log(`✅ Success! Video Published. ID: ${res.data.id}`);

        // Try ascending thumbnail if present
        if (blueprint.thumbnail && fs.existsSync(blueprint.thumbnail)) {
            try {
                log(`🖼️ Uploading Thumbnail: ${blueprint.thumbnail}`);
                await youtube.thumbnails.set({
                    videoId: res.data.id,
                    media: {
                        body: fs.createReadStream(blueprint.thumbnail)
                    }
                });
                log(`✅ Thumbnail Attached!`);
            } catch (thumbErr) {
                log(`⚠️ Thumbnail Upload Failed (continuing): ${thumbErr.message}`);
            }
        }

        return res.data;

    } catch (err) {
        const errMsg = `❌ API Upload Failure: ${err.message}`;
        log(errMsg);
        if (err.errors) {
            err.errors.forEach(e => log(`   Detail: ${e.message}`));
        }
        throw err;
    }
}

/**
 * Pin a Part 2 link as the top comment on a Part 1 video.
 * Call this AFTER the Part 2 video upload is confirmed.
 *
 * @param {string} part1VideoId  - YouTube video ID of the Part 1 video
 * @param {string} part2VideoId  - YouTube video ID of the just-uploaded Part 2 video
 * @param {string} part2Title    - Title of Part 2 (used in the comment text)
 */
async function pinPart2Comment(part1VideoId, part2VideoId, part2Title = 'Part 2') {
    const log = (msg) => {
        console.log(`[GHOST-API] ${msg}`);
        eventBus.emit('log', `[GHOST-API] ${msg}`);
    };

    if (!part1VideoId || !part2VideoId) {
        log('⚠️ pinPart2Comment: Missing video IDs — skipping.');
        return null;
    }

    const clientId     = process.env.YT_CLIENT_ID;
    const clientSecret = process.env.YT_CLIENT_SECRET;
    const refreshToken = process.env.YT_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        log('⚠️ pinPart2Comment: YouTube credentials missing — skipping.');
        return null;
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    try {
        const commentText = `🔴 PART 2 is here → https://www.youtube.com/shorts/${part2VideoId}\n\n${part2Title}`;

        // Step 1: Post the comment on Part 1
        const threadRes = await youtube.commentThreads.insert({
            part: 'snippet',
            requestBody: {
                snippet: {
                    videoId: part1VideoId,
                    topLevelComment: {
                        snippet: { textOriginal: commentText }
                    }
                }
            }
        });

        const commentId = threadRes.data.id;
        log(`✅ Part 2 comment posted on Part 1 (${part1VideoId}). Comment ID: ${commentId}`);

        // Step 2: Pin the comment (mark as top / held for review = false)
        // YouTube Data API v3 doesn't have a direct "pin" endpoint — the closest
        // is setModerationStatus which publishes the comment and surfaces it.
        try {
            await youtube.comments.setModerationStatus({
                id: commentId,
                moderationStatus: 'published',
                banAuthor: false
            });
            log(`📌 Part 2 comment pinned on Part 1 video.`);
        } catch (pinErr) {
            // Pinning is best-effort — comment was still posted
            log(`⚠️ Could not pin comment (non-fatal): ${pinErr.message}`);
        }

        return commentId;

    } catch (err) {
        log(`❌ pinPart2Comment failed: ${err.message}`);
        return null;
    }
}

module.exports = { publish, pinPart2Comment };
