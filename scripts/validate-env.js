'use strict';

/**
 * validate-env.js
 *
 * Pre-flight check for AURA environment variables.
 * Run before every pipeline execution and in CI.
 *
 * Modes:
 *   node scripts/validate-env.js             → Full check (needs real keys)
 *   node scripts/validate-env.js --template-only  → Only checks .env.example exists & is parseable
 *
 * Exit codes:
 *   0 — all critical vars present
 *   1 — one or more critical vars missing
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const TEMPLATE_ONLY = process.argv.includes('--template-only');

// ============================================================
// VARIABLE DEFINITIONS
// ============================================================
// priority: 'critical' = pipeline won't run without it
//           'recommended' = degrades gracefully
//           'optional' = nice-to-have

const ENV_VARS = [
  // Database
  { name: 'MONGODB_URI', priority: 'critical', hint: 'MongoDB Atlas connection string (free M0 cluster)' },

  // LLM Cascade — at least ONE is critical
  { name: 'GEMINI_API_KEY', priority: 'recommended', hint: 'Google AI Studio — free, 10 RPM', group: 'llm' },
  { name: 'GROQ_API_KEY', priority: 'recommended', hint: 'Groq — free, 30 RPM', group: 'llm' },
  { name: 'CEREBRAS_API_KEY', priority: 'optional', hint: 'Cerebras — free, 30 RPM', group: 'llm' },
  { name: 'MISTRAL_API_KEY', priority: 'optional', hint: 'Mistral — free, limited', group: 'llm' },
  { name: 'GITHUB_MODELS_TOKEN', priority: 'optional', hint: 'GitHub Models — free with GH account', group: 'llm' },
  { name: 'OPENROUTER_API_KEY', priority: 'optional', hint: 'OpenRouter — free tier', group: 'llm' },

  // TTS — edge-tts needs no key (always available)
  { name: 'OPENAI_API_KEY', priority: 'optional', hint: 'OpenAI TTS (paid) — optional ultra-realistic voice' },

  // Visuals — at least ONE is critical
  { name: 'PEXELS_API_KEY', priority: 'recommended', hint: 'Pexels — free, 200 req/hr', group: 'visual' },
  { name: 'PIXABAY_API_KEY', priority: 'recommended', hint: 'Pixabay — free, generous', group: 'visual' },

  // Platform Publishers
  { name: 'YT_TECH_MAIN_CLIENT_ID', priority: 'optional', hint: 'YouTube OAuth client ID', group: 'youtube' },
  { name: 'YT_TECH_MAIN_CLIENT_SECRET', priority: 'optional', hint: 'YouTube OAuth client secret', group: 'youtube' },
  { name: 'YT_TECH_MAIN_REFRESH_TOKEN', priority: 'optional', hint: 'YouTube OAuth refresh token', group: 'youtube' },
  { name: 'IG_TECH_MAIN_ACCESS_TOKEN', priority: 'optional', hint: 'Instagram Graph API token', group: 'instagram' },
  { name: 'IG_TECH_MAIN_USER_ID', priority: 'optional', hint: 'Instagram user/page ID', group: 'instagram' },

  // Affiliate
  { name: 'BITLY_API_KEY', priority: 'optional', hint: 'Bitly — free 1,000 links/mo' },

  // Dashboard
  { name: 'DASHBOARD_JWT_SECRET', priority: 'optional', hint: 'JWT secret for dashboard auth' },
  { name: 'DASHBOARD_ADMIN_PASS', priority: 'optional', hint: 'Dashboard admin password' },

  // Temp hosting (for Instagram)
  { name: 'SUPABASE_URL', priority: 'optional', hint: 'Supabase project URL', group: 'temp_hosting' },
  { name: 'SUPABASE_ANON_KEY', priority: 'optional', hint: 'Supabase anon key', group: 'temp_hosting' },
  { name: 'CF_R2_ACCOUNT_ID', priority: 'optional', hint: 'Cloudflare R2 account ID', group: 'temp_hosting' },
  { name: 'CF_R2_ACCESS_KEY_ID', priority: 'optional', hint: 'Cloudflare R2 access key', group: 'temp_hosting' },
  { name: 'CF_R2_SECRET_ACCESS_KEY', priority: 'optional', hint: 'Cloudflare R2 secret key', group: 'temp_hosting' },
];

// ============================================================
// TEMPLATE-ONLY MODE
// ============================================================
if (TEMPLATE_ONLY) {
  const templatePath = path.join(__dirname, '..', '.env.example');
  if (!fs.existsSync(templatePath)) {
    console.error('FAIL: .env.example not found');
    process.exit(1);
  }

  const content = fs.readFileSync(templatePath, 'utf8');
  const templateVars = content.match(/^[A-Z][A-Z0-9_]+=.*/gm) || [];
  const templateNames = templateVars.map(line => line.split('=')[0]);

  console.log(`\n.env.example contains ${templateNames.length} variables`);

  // Verify all ENV_VARS are present in template
  let missing = 0;
  for (const v of ENV_VARS) {
    if (!templateNames.includes(v.name)) {
      console.warn(`  WARN: ${v.name} not in .env.example`);
      missing++;
    }
  }

  if (missing > 0) {
    console.warn(`\n${missing} variable(s) missing from template (non-blocking)`);
  }

  console.log('Template validation PASSED\n');
  process.exit(0);
}

// ============================================================
// FULL VALIDATION MODE
// ============================================================
console.log('\n' + '='.repeat(55));
console.log(' AURA Environment Validation');
console.log('='.repeat(55) + '\n');

const results = { critical: [], recommended: [], optional: [] };
let criticalFail = false;

for (const v of ENV_VARS) {
  const value = process.env[v.name];
  const present = !!value && value.trim().length > 0;

  if (!present) {
    results[v.priority].push({ name: v.name, status: 'MISSING', hint: v.hint });
    if (v.priority === 'critical') criticalFail = true;
  } else {
    results[v.priority].push({ name: v.name, status: 'OK' });
  }
}

// Group validation: at least one LLM key must exist
const llmVars = ENV_VARS.filter(v => v.group === 'llm');
const hasAnyLLM = llmVars.some(v => process.env[v.name]?.trim());
if (!hasAnyLLM) {
  console.error('CRITICAL: No LLM API key found. At least ONE is required.');
  console.error('  Cheapest option: GEMINI_API_KEY (free at https://aistudio.google.com)\n');
  criticalFail = true;
}

// Print results
for (const [level, items] of Object.entries(results)) {
  const icon = level === 'critical' ? '🔴' : level === 'recommended' ? '🟡' : '⚪';
  console.log(`${icon} ${level.toUpperCase()}:`);
  for (const item of items) {
    const statusIcon = item.status === 'OK' ? '✅' : '❌';
    const hint = item.hint ? ` — ${item.hint}` : '';
    console.log(`  ${statusIcon} ${item.name}${item.status === 'MISSING' ? hint : ''}`);
  }
  console.log('');
}

// Summary
const totalMissing = Object.values(results).flat().filter(r => r.status === 'MISSING').length;
const totalPresent = Object.values(results).flat().filter(r => r.status === 'OK').length;

console.log('='.repeat(55));
console.log(`  ${totalPresent} present / ${totalMissing} missing`);

if (criticalFail) {
  console.error('\n❌ VALIDATION FAILED — critical variables missing\n');
  process.exit(1);
} else {
  console.log('\n✅ VALIDATION PASSED — pipeline can run\n');
  process.exit(0);
}
