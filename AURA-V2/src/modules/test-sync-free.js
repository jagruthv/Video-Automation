const fs = require('fs');
const path = require('path');
const { Communicate } = require('edge-tts-universal');

/**
 * MISSION: Test if we can get WordBoundary metadata for FREE.
 * This is the 'Millionaire-Proof' way to get perfect sync.
 */
async function testFreeSync() {
    console.log('[TEST] Checking WordBoundary events (Zero-Cost Sync)...');
    
    const text = "Aura V2 is synchronizing.";
    const communicate = new Communicate(text, {
        voice: 'en-US-SteffanNeural',
        rate: '+15%'
    });

    const words = [];
    const chunks = [];

    // Capture everything from the stream
    for await (const chunk of communicate.stream()) {
        if (chunk.type === 'audio') {
            chunks.push(chunk.data);
        } else if (chunk.type === 'WordBoundary') {
            // This is the gold! Free timestamps from Microsoft.
            words.push({
                text: chunk.text,
                offset: chunk.audioOffset / 10000, // Convert to ms
                duration: chunk.duration / 10000  // Convert to ms
            });
            console.log(`[FOUND] "${chunk.text}" at ${chunk.audioOffset / 10000}ms`);
        }
    }

    if (words.length > 0) {
        console.log(`\n✅ SUCCESS! Captured ${words.length} word-level timestamps for free.`);
        process.exit(0);
    } else {
        console.error('\n❌ FAILURE: No metadata events captured. Library version might be too old.');
        process.exit(1);
    }
}

testFreeSync().catch(console.error);
