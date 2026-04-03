'use strict';

const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const { LLMHealth } = require('../db/schema');

const log = getModuleLogger('llm-cascade');

/**
 * Build the Vibecoder Mega-Prompt for scriptwriting.
 * The LLM acts as Art Director, choosing visuals and FFmpeg effects.
 * @returns {string}
 */
function buildSystemPrompt() {
  return `You are 'The Vibecoder', a highly energetic Gen-Z tech YouTuber AND an AI Art Director for YouTube Shorts.

SCRIPT RULES:
1. Hook the viewer in 3 seconds. Start with "Stop scrolling!" or "Wait — don't swipe!" then drop a mind-blowing fact.
2. NO STAGE DIRECTIONS. No brackets, asterisks, timestamps. ONLY spoken words.
3. PACING IS CRITICAL. DO NOT USE COMMAS. Every single thought ends with a full stop on its own line.
   BAD: 'This AI is crazy, it codes for you, and it is free.'
   GOOD:
   'This AI is crazy.'
   'It codes for you.'
   'And it is completely free.'
4. End with a benefit-driven CTA: "Subscribe to Vibecoder Daily to stay ahead of 99% of coders."

VISUAL SEQUENCE RULES:
You must direct a sequence of 6 to 8 visual scenes that perfectly match the script.
You must output a mix of highly descriptive AI image prompts AND concise video search queries.

VIDEO EFFECT RULES:
For EVERY scene (whether video or image), pick EXACTLY ONE effect from this list: zoom_in, pan_right, cyberpunk_color, bw_hacker, glitch.

LENGTH REQUIREMENT:
You MUST write exactly 80 to 100 words in the script. The video must be at least 45 seconds long. Do not write short 30-word scripts.

DESCRIPTION RULES:
Write a high-energy YouTube description mixing English and conversational Telugu (Tanglish).
Must follow this structure:
- Start with a Telugu hook like "Eppudaina chusara...?" or "Mee life change avutundi bro..."
- 3 bullet points summarising the key revelations in the video.
- Call to action: "Vibecoder Daily ki subscribe cheyyandi future tech updates kosam!"
- End with 15 comma-separated SEO hashtags (e.g., #AITech, #CodingShorts).

OUTPUT FORMAT: Respond ONLY with a single valid JSON object. No markdown fences. No explanation:
{
  "script": "The complete spoken text, with each sentence on its own line. No commas. Full stops only. MUST be 80-100 words.",
  "visuals": [{"type": "video", "query": "hacker typing", "effect": "zoom_in"}, {"type": "image", "prompt": "photorealistic glowing cyberpunk robot, 8k", "effect": "cyberpunk_color"}],
  "youtubeTitle": "Max 70 chars. High energy. 1 emoji. Include #shorts.",
  "youtubeDescription": "Tanglish description following exact structure above."
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

You are the Vibecoder AI Director. Output the JSON object now. No markdown. No explanation.`;
}

/**
 * Try to parse JSON from LLM response, handling markdown fences.
 * @param {string} text
 * @returns {Object}
 */
function parseScriptJSON(text) {
  // Direct parse first
  try { return JSON.parse(text); } catch { }

  // Try extracting from markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch { }
  }

  // Try finding first { to last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.substring(start, end + 1)); } catch { }
  }

  throw new Error('Failed to parse JSON from LLM response');
}

/**
 * Validate that the parsed script has all required fields.
 * @param {Object} script
 * @returns {boolean}
 */
function validateScript(script) {
  if (!script || typeof script !== 'object') return false;
  if (!script.script) return false;
  
  // Word count validation to force fallback reprompting on lazy LLMs
  const wordCount = script.script.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 60) {
    throw new Error(`Script length validation failed: Only ${wordCount} words (minimum 60 strictly required.)`);
  }

  // Validate internals
  return !!(
    script.visuals &&
    Array.isArray(script.visuals) &&
    script.visuals.length >= 4 &&
    script.youtubeTitle &&
    script.youtubeDescription
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
// PROVIDER DEFINITIONS & CORE ROUTING LOGIC
// ============================================================

const modelCascade = [
  { provider: 'groq', id: 'openai/gpt-oss-120b' },
  { provider: 'groq', id: 'llama-3.3-70b-versatile' },
  { provider: 'gemini', id: 'gemini-3-flash' },
  { provider: 'gemini', id: 'gemini-2.5-flash' },
  { provider: 'groq', id: 'qwen/qwen3-32b' },
  { provider: 'groq', id: 'openai/gpt-oss-20b' },
  { provider: 'groq', id: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { provider: 'groq', id: 'llama-3.1-8b-instant' },
  { provider: 'gemini', id: 'gemini-3.1-flash-lite' },
  { provider: 'gemini', id: 'gemini-2.5-flash-lite' }
];

async function generateLlmResponse(provider, modelId, systemPrompt, userPrompt) {
  if (provider === 'groq') {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error('GROQ_API_KEY not set');
    
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ 
        model: modelId, 
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], 
        temperature: 0.9, 
        max_tokens: 2048, 
        response_format: { type: "json_object" } 
      }),
      signal: AbortSignal.timeout(30000)
    });
    
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content;
  } 
  
  if (provider === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not set');
    
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }], 
        generationConfig: { temperature: 0.9, maxOutputTokens: 2048, responseMimeType: "application/json" } 
      }),
      signal: AbortSignal.timeout(40000)
    });
    
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text;
  }
  
  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Generate a video script using the 10-model LLM cascade.
 * Tries each provider in order. If one fails, instantly tries next.
 * NEVER fails unless ALL 10 models are down or exhausted.
 *
 * @param {string} topic - The trending topic
 * @param {string} verticalId - Content vertical
 * @param {string} channelPersona - Channel's content style description
 * @param {Object} topicMeta - { source, sourceUrl, viralityScore }
 * @returns {Promise<{script: Object, provider: string}>}
 */
async function generateScript(topic, verticalId, channelPersona, topicMeta = {}) {
  const systemPrompt = buildSystemPrompt();
  const baseUserPrompt = buildUserPrompt(
    topic,
    topicMeta.source || 'auto-discovered',
    topicMeta.sourceUrl || '',
    topicMeta.viralityScore || 50
  );

  for (const model of modelCascade) {
    const identifier = `${model.provider}-${model.id}`;
    
    if (await shouldSkipProvider(identifier)) continue;

    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const userPrompt = attempt === 1 
          ? baseUserPrompt 
          : `${baseUserPrompt}\n\nCRITICAL FEEDBACK: Your previous attempt failed validation: "${lastError}". Please fix the JSON and ensure the script is 80-100 words AS STRICTLY REQUESTED.`;

        log.info(`Trying ${identifier} (attempt ${attempt}/2)...`);
        const rawText = await generateLlmResponse(model.provider, model.id, systemPrompt, userPrompt);

        if (!rawText) throw new Error('Empty response');

        const parsed = parseScriptJSON(rawText);
        if (!validateScript(parsed)) throw new Error('Invalid script structure or length requirements not met');

        await recordProviderResult(identifier, true);
        log.info(`Script generated via ${identifier} — "${parsed.youtube_title}"`);
        return { script: parsed, provider: identifier };
      } catch (err) {
        lastError = err.message;
        log.warn(`${identifier} attempt ${attempt} failed: ${err.message}`);
        
        if (err.message.includes('404') || err.message.includes('429') || err.message.includes('not set')) {
          break; // Skip retry and move to next model if API key issue or rate limit
        }
        
        if (attempt === 2) {
          await recordProviderResult(identifier, false);
          log.warn(`${identifier} exhausted. Moving to next provider...`);
        }
      }
    }
  }

  throw new Error('ALL_LLM_PROVIDERS_EXHAUSTED — no script could be generated');
}

module.exports = { generateScript, modelCascade, buildSystemPrompt, buildUserPrompt, validateScript };
