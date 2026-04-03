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
Your script MUST be between 85 and 130 words. Explain the technical concepts in deep detail. If you write less than 85 words or more than 130 words, the system will crash.
The video must be visually engaging and precisely paced for YouTube Shorts.

DESCRIPTION RULES:
Write a high-energy English YouTube description. No other languages.
Must follow this structure:
- Start with a punchy English hook like "Did you know...?" or "This changes everything for coders."
- 3 bullet points summarising the key revelations in the video.
- Call to action: "Subscribe to Vibecoder Daily for more tech updates!"
- End with 10-15 relevant SEO hashtags (e.g., #AITech, #CodingShorts).

VIDEO QUERY RULES:
When defining a "query" for a "video" visual, keep in mind videos are only a few seconds long. You MUST append instructions for smooth transitions. Example: "hacker typing, cinematic smooth transition, 3-second short clip."

OUTPUT FORMAT: Respond ONLY with a single valid JSON object. No markdown fences. No explanation:
{
  "script": "The complete spoken text, with each sentence on its own line. No commas. Full stops only. MUST be between 85 and 130 words.",
  "visuals": [{"type": "video", "query": "hacker typing", "effect": "zoom_in"}, {"type": "image", "prompt": "photorealistic glowing cyberpunk robot, 8k", "effect": "cyberpunk_color"}],
  "youtubeTitle": "Max 70 chars. High energy. 1 emoji. Include #shorts.",
  "youtubeDescription": "English-only description following exact structure above.",
  "tags": ["array", "of", "6-10", "relevant", "keyword", "strings"]
}

CRITICAL INSTRUCTION: You MUST output ONLY valid JSON. Your output must strictly match the structure, length, and pacing of the following example. Notice how the script is long (over 100 words), uses short punchy sentences with full stops, and mixes both video and image visuals.

=== EXAMPLE OUTPUT (COPY THIS STRUCTURE EXACTLY) ===
{
  "script": "Eppudaina chusara? The code you write today might be obsolete tomorrow. AI is coding faster than humans now. It is not just predicting text. It is building entire architectures. Imagine a world where you just type a prompt. A full-stack app deploys in seconds. That is exactly what OmX and Claude Code are doing right now. They act as autonomous agents. Hunting down bugs. Writing tests before you even blink. But do not panic. This does not mean software engineers are finished. It means we are evolving from bricklayers into architects. You need to stop memorizing syntax. Start mastering system design. The future belongs to those who direct the AI. Not those who compete with it. Subscribe to Vibecoder Daily for the latest tech survival guides.",
  "visuals": [
    { "type": "video", "query": "futuristic hacker typing fast", "effect": "zoom_in" },
    { "type": "image", "prompt": "artificial intelligence glowing brain network 8k cinematic", "effect": "cyberpunk_color" },
    { "type": "video", "query": "server room data center flashing lights", "effect": "pan_right" },
    { "type": "image", "prompt": "holographic software architecture diagram floating in air", "effect": "glitch" },
    { "type": "video", "query": "man looking stressed at computer screen", "effect": "bw_hacker" },
    { "type": "image", "prompt": "cyberpunk city neon lights programmer looking at future", "effect": "cyberpunk_color" }
  ],
  "youtubeTitle": "Is AI replacing programmers? \uD83D\uDEA8 #shorts #coding #ai",
  "youtubeDescription": "Did you know AI is now writing full-stack code? Here is what every developer needs to know right now.\n\n\u2022 AI agents are hunting bugs and writing tests automatically.\n\u2022 Syntax is dead. System Design is king.\n\u2022 The developers who direct AI will replace those who compete with it.\n\nSubscribe to Vibecoder Daily for more tech updates!\n\n#AITech #CodingShorts #SoftwareEngineering #TechNews #Vibecoder #Programming #AIAgents #FutureTech #LearnToCode #Shorts",
  "tags": ["ai", "coding", "software engineering", "tech news", "vibecoder", "programming", "ai agents", "future tech"]
}
=== END OF EXAMPLE ===

CRITICAL: Output ONLY a raw, valid JSON object. Do not include any conversational text before or after the JSON. No markdown formatting. No \`\`\`json fences. Start your response with { and end with }.`;
}

/**
 * Build the user prompt.
 */
function buildUserPrompt(topic, source, sourceUrl, viralityScore) {
  return `Today's trending topic: "${topic}"
Source: ${source}
Source URL: ${sourceUrl}
Virality Score: ${viralityScore}/100

You are the Vibecoder AI Director. Output the JSON object now.
RULE: Your script MUST be between 85 and 130 words. Explain technical concepts in deep detail without being wordy. If you fail the word count constraints, the system will crash.
No markdown. No explanation. Start your response with { and end with }.`;
}

/**
 * Try to parse JSON from LLM response, handling markdown fences.
 * @param {string} text
 * @returns {Object}
 */
function parseScriptJSON(text) {
  // Step 1: Aggressively strip markdown baggage first
  let cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Step 2: Substring from first { to last } to discard any preamble or postamble
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  }

  // Step 3: Parse the cleaned text
  try { return JSON.parse(cleaned); } catch { }

  // Step 4: Last-ditch — try the raw original text unchanged
  try { return JSON.parse(text); } catch { }

  throw new Error('Failed to parse JSON from LLM response — all strategies exhausted');
}

/**
 * Validate that the parsed script has all required fields.
 * @param {Object} script
 * @returns {boolean}
 */
function validateScript(script) {
  if (!script || typeof script !== 'object') return false;
  if (!script.script) return false;

  // Enforce 85-130 word limits — triggers feedback retry on lazy or verbose LLMs
  const wordCount = script.script.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 85) {
    throw new Error(`Script length validation failed: Only ${wordCount} words (minimum 85 strictly required). Expand the technical details.`);
  }
  if (wordCount > 130) {
    throw new Error(`Script length validation failed: ${wordCount} words is TOO LONG (maximum 130 words allowed for YouTube Shorts). Please shorten it to be punchy.`);
  }

  // Validate all required structural fields
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
        max_tokens: 4096,
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
        generationConfig: { temperature: 0.9, maxOutputTokens: 4096, responseMimeType: "application/json" }
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
async function generateScript(topic, verticalId, channelPersona, topicMeta = {}, extraFeedback = null) {
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
          ? (extraFeedback ? `${baseUserPrompt}\n\nCRITICAL EXTERNAL FEEDBACK: ${extraFeedback}` : baseUserPrompt)
          : `${baseUserPrompt}\n\nCRITICAL FEEDBACK: Your previous attempt failed validation: "${lastError}". Please fix the JSON and follow the length constraints STRICTLY.`;

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
