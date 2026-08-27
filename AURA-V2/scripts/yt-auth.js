require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const clientId = process.env.YT_CLIENT_ID;
const clientSecret = process.env.YT_CLIENT_SECRET;

if (!clientId || !clientSecret) {
    console.error('❌ ERROR: Ensure YT_CLIENT_ID and YT_CLIENT_SECRET are set in your .env file.');
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'urn:ietf:wg:oauth:2.0:oob'
);

const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
    prompt: 'consent' // Forces a new refresh token even if previously authorized
});

console.log('\n======================================================');
console.log('🔴 YOUTUBE AUTHENTICATOR (AURA-V2)');
console.log('======================================================\n');
console.log('1. Click or Paste this exact URL in your browser:\n');
console.log(url, '\n');
console.log('2. Log in with your YouTube Google Account and click "Allow".');
console.log('3. Copy the "Authorization Code" they give you.\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('👉 Paste the Authorization Code here: ', async (code) => {
    rl.close();
    try {
        console.log('\n🔄 Exchanging code for tokens...');
        const { tokens } = await oauth2Client.getToken(code.trim());
        
        if (tokens.refresh_token) {
            const envPath = path.join(__dirname, '..', '.env');
            let envData = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
            
            // Regex to replace or add YT_REFRESH_TOKEN safely
            if (/^YT_REFRESH_TOKEN=/m.test(envData)) {
                envData = envData.replace(/^YT_REFRESH_TOKEN=.*$/m, `YT_REFRESH_TOKEN=${tokens.refresh_token}`);
            } else {
                envData += `\nYT_REFRESH_TOKEN=${tokens.refresh_token}`;
            }
            
            fs.writeFileSync(envPath, envData);
            console.log('\n✅ SUCCESS! New Refresh Token saved to your .env file.');
            console.log('   (You may want to restart your backend terminal now that it is updated)\n');
        } else {
            console.error('\n⚠️ Code worked, but Google did NOT return a refresh_token. Make sure you use a new login or revoked the old permissions first.');
        }
    } catch (err) {
        console.error('\n❌ Failed to exchange code:', err.message);
    }
});
