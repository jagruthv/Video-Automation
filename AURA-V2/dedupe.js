const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIRECTORY = 'D:\\Automation\\n8n\\asmr-qa-vault\\public\\accepted_vault';

async function calculateHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function runDedupe() {
    console.log(`Scanning for duplicates in: ${DIRECTORY}`);
    if (!fs.existsSync(DIRECTORY)) {
        console.error("Directory not found!");
        return;
    }

    const files = fs.readdirSync(DIRECTORY).filter(f => f.endsWith('.mp4'));
    console.log(`Found ${files.length} mp4 files to check...`);

    const hashes = {};
    let duplicatesDeleted = 0;
    let bytesSaved = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = path.join(DIRECTORY, file);
        try {
            const stats = fs.statSync(filePath);
            if (!stats.isFile()) continue;

            const hash = await calculateHash(filePath);

            if (hashes[hash]) {
                console.log(`[DUPLICATE] 🗑️ Deleting ${file} (matches ${hashes[hash]})`);
                fs.unlinkSync(filePath);
                duplicatesDeleted++;
                bytesSaved += stats.size;
            } else {
                hashes[hash] = file;
            }
        } catch (e) {
            console.error(`Error processing ${file}: ${e.message}`);
        }
    }

    console.log('\n--- DEDUPLICATION COMPLETE ---');
    console.log(`Duplicates Deleted: ${duplicatesDeleted}`);
    console.log(`Storage Saved: ${(bytesSaved / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Unique Videos Remaining: ${Object.keys(hashes).length}`);
}

runDedupe().catch(console.error);
