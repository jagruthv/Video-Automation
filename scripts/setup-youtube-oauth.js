'use strict';

/**
 * setup-youtube-oauth.js
 *
 * Interactive CLI helper to obtain YouTube OAuth2 refresh tokens.
 * Run ONCE per YouTube channel, then store the refresh token as a
 * GitHub Actions secret.
 *
 * Usage:
 *   node scripts/setup-youtube-oauth.js
 *
 * Prerequisites:
 *   1. Create a Google Cloud project at https://console.cloud.google.com
 *   2. Enable "YouTube Data API v3"
 *   3. Create OAuth 2.0 credentials (Desktop App type)
 *   4. Download the client_id and client_secret
 *
 * The script will:
 *   1. Ask for client_id and client_secret
 *   2. Generate an auth URL → open it in browser
 *   3. Ask you to paste the authorization code
 *   4. Exchange code for tokens
 *   5. Print the refresh_token to store as a secret
 */

const { google } = require('googleapis');
const readline = require('readline');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl'
];

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function main() {
  console.log('\n' + '='.repeat(55));
  console.log(' AURA — YouTube OAuth2 Setup');
  console.log('='.repeat(55));
  console.log('\nThis script helps you obtain a YouTube refresh token.');
  console.log('You need a Google Cloud project with YouTube Data API v3 enabled.\n');

  const clientId = await ask('Enter CLIENT_ID: ');
  const clientSecret = await ask('Enter CLIENT_SECRET: ');

  if (!clientId || !clientSecret) {
    console.error('Both CLIENT_ID and CLIENT_SECRET are required.');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'  // Force consent to get refresh_token
  });

  console.log('\n' + '-'.repeat(55));
  console.log('Step 1: Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n' + '-'.repeat(55));
  console.log('Step 2: Sign in with the Google account that owns the YouTube channel.');
  console.log('Step 3: Grant access and copy the authorization code.\n');

  const code = await ask('Paste the authorization code here: ');

  if (!code) {
    console.error('Authorization code is required.');
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2.getToken(code);

    console.log('\n' + '='.repeat(55));
    console.log(' SUCCESS! Store these as GitHub Actions secrets:');
    console.log('='.repeat(55));
    console.log(`\n  ACCESS_TOKEN:  ${tokens.access_token?.substring(0, 20)}...`);
    console.log(`  REFRESH_TOKEN: ${tokens.refresh_token}`);
    console.log(`  TOKEN_TYPE:    ${tokens.token_type}`);
    console.log(`  EXPIRY:        ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'N/A'}`);

    console.log('\n' + '-'.repeat(55));
    console.log('Add to GitHub Secrets:');
    console.log(`  YT_<CHANNEL>_CLIENT_ID     = ${clientId}`);
    console.log(`  YT_<CHANNEL>_CLIENT_SECRET  = ${clientSecret}`);
    console.log(`  YT_<CHANNEL>_REFRESH_TOKEN  = ${tokens.refresh_token}`);
    console.log('-'.repeat(55));

    // Verify the token works
    console.log('\nVerifying token...');
    oauth2.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2 });
    const channelRes = await youtube.channels.list({ part: 'snippet', mine: true });
    const channel = channelRes.data.items?.[0];

    if (channel) {
      console.log(`✅ Connected to: ${channel.snippet.title} (${channel.id})`);
    } else {
      console.warn('⚠️  Token works but no channel found on this account.');
    }

  } catch (err) {
    console.error(`\n❌ Token exchange failed: ${err.message}`);
    console.error('Check that the authorization code is correct and hasn\'t expired.');
    process.exit(1);
  }

  console.log('\nDone! You can now close this terminal.\n');
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
