'use strict';

const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const { LLMHealth } = require('../db/schema');

const log = getModuleLogger('llm-cascade');

/**
 * Build the system prompt for scriptwriting.
 * @param {string} verticalId
 * @param {string} channelPersona
 * @returns {string}
 */
function buildSystemPrompt(verticalId, channelPersona) {
  return `You are AURA-WRITER, an expert viral short-form video scriptwriter with 10 million followers. You specialize in explaining complex topics so simply that a 12-year-old would understand, while keeping adults hooked.

CONTENT VERTICAL: ${verticalId}
CHANNEL PERSONA: ${channelPersona}

RULES YOU MUST FOLLOW:
1. The script must be EXACTLY 50-55 seconds when read aloud at natural pace
2. First 3 seconds = a pattern-interrupt hook (question, shocking stat, or bold claim)
3. Body = clear 3-act structure: Setup (10s), Conflict/Problem (20s), Resolution (15s)
4. Use conversational tone — contractions, rhetorical questions, "you" and "imagine"
5. ZERO jargon. Replace technical terms with analogies
6. End with a soft CTA: "Follow for more" or "Comment which concept next"
7. Include 2 intentional micro-pauses marked with [PAUSE_0.5s] for dramatic effect
8. Each script must feel UNIQUE — vary sentence structure, rhythm, and hook style

OUTPUT FORMAT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences.
{
  "hook": "The first 3 seconds. Must create curiosity or shock.",
  "body": "The remaining 47 seconds. Include [PAUSE_0.5s] markers.",
  "full_script": "hook + body combined, ready for TTS",
  "visual_keywords_for_pexels": ["keyword1", "keyword2", "keyword3", "keyword4"],
  "visual_scene_descriptions": [
    {"timestamp": "0-3s", "description": "Scene description for visuals"},
    {"timestamp": "3-15s", "description": "Scene description"},
    {"timestamp": "15-35s", "description": "Scene description"},
    {"timestamp": "35-50s", "description": "Scene description"}
  ],
  "youtube_title": "Max 70 chars. Use power words. Include 1 emoji.",
  "youtube_description": "2-3 sentences with relevant hashtags.",
  "youtube_tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "instagram_caption": "Optimized for IG with emojis and hashtags. Max 2200 chars.",
  "estimated_reading_time_seconds": 52,
  "mood": "exciting"
}`;
}

/**
 * Build the user prompt.
 */
function buildUserPrompt(topic, source, sourceUrl, viralityScore) {
  return `Today's trending topic: "${topic}"
Source: ${source}
Source URL: ${sourceUrl}
Virality Score: ${viralityScore}/100

Write the script now. Remember: JSON only, no markdown fences.`;
}

/**
 * Try to parse JSON from LLM response, handling markdown fences.
 * @param {string} text
 * @returns {Object}
 */
function parseScriptJSON(text) {
  // Direct parse first
  try { return JSON.parse(text); } catch {}

  // Try extracting from markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch {}
  }

  // Try finding first { to last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.substring(start, end + 1)); } catch {}
  }

  throw new Error('Failed to parse JSON from LLM response');
}

/**
 * Validate that the parsed script has all required fields.
 * @param {Object} script
 * @returns {boolean}
 */
function validateScript(script) {
  return !!(
    script.hook &&
    script.body &&
    script.full_script &&
    script.visual_keywords_for_pexels &&
    Array.isArray(script.visual_keywords_for_pexels) &&
    script.youtube_title &&
    script.youtube_tags &&
    Array.isArray(script.youtube_tags)
  );
}

/**
 * Check if a provider should be skipped (too many recent failures).
 * @param {string} providerName
 * @returns {Promise<boolean>}
 */
async function shouldSkipProvider(providerName) {
  try {
    const health = await LLMHealth.findOne({ provider: providerName });
    if (!health) return false;
    if (health.skipUntil && health.skipUntil > new Date()) {
      log.info(`Skipping ${providerName} (cooldown until ${health.skipUntil.toISOString()})`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Record provider success or failure.
 * If 5 consecutive failures, skip for 2 hours.
 */
async function recordProviderResult(providerName, success) {
  try {
    if (success) {
      await LLMHealth.findOneAndUpdate(
        { provider: providerName },
        { consecutiveFailures: 0, lastSuccess: new Date(), $inc: { totalCalls: 1 }, skipUntil: null },
        { upsert: true }
      );
    } else {
      const health = await LLMHealth.findOneAndUpdate(
        { provider: providerName },
        { lastFailure: new Date(), $inc: { totalCalls: 1, totalFailures: 1, consecutiveFailures: 1 } },
        { upsert: true, new: true }
      );
      if (health && health.consecutiveFailures >= 5) {
        const skipUntil = new Date(Date.now() + 2 * 60 * 60 * 1000);
        await LLMHealth.findOneAndUpdate(
          { provider: providerName },
          { skipUntil }
        );
        log.warn(`${providerName}: 5 consecutive failures — skipping until ${skipUntil.toISOString()}`);
      }
    }
  } catch (err) {
    log.warn(`Failed to record provider result: ${err.message}`);
  }
}

// ============================================================
// PROVIDER DEFINITIONS (corrected endpoints and limits)
// ============================================================

const providers = [
  {
    name: 'gemini-2.5-flash',
    // Corrected: 10 RPM, 250 RPD on free tier
    async generate(systemPrompt, userPrompt) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY not set');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { temperature: 0.9, maxOutputTokens: 2048 }
          }),
          signal: AbortSignal.timeout(30000)
        }
      );
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No text in Gemini response');
      return text;
    }
  },
  {
    name: 'groq-llama-3.3-70b',
    // Corrected: 30 RPM, 1,000 RPD
    async generate(systemPrompt, userPrompt) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new Error('GROQ_API_KEY not set');
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.9, max_tokens: 2048
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data?.choices?.[0]?.message?.content;
    }
  },
  {
    name: 'cerebras-llama-3.3-70b',
    // Corrected: 30 RPM, 1M tokens/day
    async generate(systemPrompt, userPrompt) {
      const key = process.env.CEREBRAS_API_KEY;
      if (!key) throw new Error('CEREBRAS_API_KEY not set');
      const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.9, max_tokens: 2048
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`Cerebras HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data?.choices?.[0]?.message?.content;
    }
  },
  {
    name: 'mistral-small',
    // Corrected: Shared pool, variable limits — monitor usage
    async generate(systemPrompt, userPrompt) {
      const key = process.env.MISTRAL_API_KEY;
      if (!key) throw new Error('MISTRAL_API_KEY not set');
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.9, max_tokens: 2048
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`Mistral HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data?.choices?.[0]?.message?.content;
    }
  },
  {
    name: 'github-models-gpt4o',
    // Corrected: 10-15 RPM, 50-150 RPD depends on plan
    async generate(systemPrompt, userPrompt) {
      const key = process.env.GITHUB_MODELS_TOKEN;
      if (!key) throw new Error('GITHUB_MODELS_TOKEN not set');
      const res = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.9, max_tokens: 2048
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`GitHub Models HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data?.choices?.[0]?.message?.content;
    }
  },
  {
    name: 'openrouter-deepseek-r1',
    // Corrected: 20 RPM, 200 RPD for free models
    async generate(systemPrompt, userPrompt) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error('OPENROUTER_API_KEY not set');
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': 'https://aura-bot.dev',
          'X-Title': 'AURA'
        },
        body: JSON.stringify({
          model: 'deepseek/deepseek-r1:free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.9, max_tokens: 2048
        }),
        signal: AbortSignal.timeout(45000) // DeepSeek R1 is slower (reasoning)
      });
      if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data?.choices?.[0]?.message?.content;
    }
  }
];

/**
 * Generate a video script using the 6-model LLM cascade.
 * Tries each provider in order. If one fails, instantly tries next.
 * NEVER fails unless ALL 6 providers are down.
 *
 * @param {string} topic - The trending topic
 * @param {string} verticalId - Content vertical
 * @param {string} channelPersona - Channel's content style description
 * @param {Object} topicMeta - { source, sourceUrl, viralityScore }
 * @returns {Promise<{script: Object, provider: string}>}
 */
async function generateScript(topic, verticalId, channelPersona, topicMeta = {}) {
  const systemPrompt = buildSystemPrompt(verticalId, channelPersona);
  const userPrompt = buildUserPrompt(
    topic,
    topicMeta.source || 'auto-discovered',
    topicMeta.sourceUrl || '',
    topicMeta.viralityScore || 50
  );

  for (const provider of providers) {
    // Check if provider should be skipped (5+ consecutive failures)
    if (await shouldSkipProvider(provider.name)) continue;

    try {
      log.info(`Trying ${provider.name}...`);
      const rawText = await provider.generate(systemPrompt, userPrompt);

      if (!rawText) throw new Error('Empty response');

      const parsed = parseScriptJSON(rawText);
      if (!validateScript(parsed)) throw new Error('Invalid script structure — missing required fields');

      await recordProviderResult(provider.name, true);
      log.info(`Script generated via ${provider.name} — "${parsed.youtube_title}"`);
      return { script: parsed, provider: provider.name };
    } catch (err) {
      await recordProviderResult(provider.name, false);
      log.warn(`${provider.name} failed: ${err.message}. Trying next...`);
      continue;
    }
  }

  throw new Error('ALL_LLM_PROVIDERS_EXHAUSTED — no script could be generated');
}

module.exports = { generateScript, providers, buildSystemPrompt, buildUserPrompt };
