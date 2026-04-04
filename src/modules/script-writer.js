'use strict';

const { getModuleLogger } = require('../utils/logger');
const log = getModuleLogger('script-writer');

// ============================================================
// MASTER FORMAT VAULT — 6 Proven Viral YouTube Shorts Frameworks
// A random format is selected on each execution for variety.
// ============================================================
const promptVault = [
  {
    formatName: 'Classic 3-Fact Countdown',
    systemInstruction: `You are an elite YouTube Shorts visual storyteller.
FORMAT: Classic 3-Fact Countdown.
HOOK: Start with one bold, intriguing statement.
BODY:
- Number three: A genuinely surprising fact. 1-2 sentences.
- Number two: Even more surprising. 1 sentence.
- Number one: The most interesting fact of all.
OUTRO: One short question to drive comments.
SCRIPT RULES: Max 110 words total. Fast pacing. Full stops only. No commas. Write numbers as words. English only.`
  },
  {
    formatName: 'Everyday Object Secret',
    systemInstruction: `You are an elite YouTube Shorts visual storyteller.
FORMAT: Everyday Object Secret.
HOOK: "Have you ever wondered what [feature] on [common object] is actually for?"
BODY: Reveal the real, engineering-driven reason for the feature. Add 2 more related object secrets.
- FINAL REVEAL: The most unexpected object secret.
OUTRO: "What did you think it was for?"
SCRIPT RULES: Max 110 words total. Fast pacing. Full stops only. No commas. English only.`
  },
  {
    formatName: 'Simulation Glitch',
    systemInstruction: `You are an elite YouTube Shorts visual storyteller.
FORMAT: Simulation / Glitch Theory.
HOOK: "Three strange phenomena in your body that feel like glitches."
BODY: Present 3 real, documented phenomena of the human body (like the Troxler effect) that feel surreal.
- NUMBER ONE GLITCH: The most existentially bizarre one.
OUTRO: "Which glitch do you have?"
SCRIPT RULES: Max 110 words total. Fast pacing. Full stops only. No commas. English only.`
  },
  {
    formatName: 'The Curious Warning',
    systemInstruction: `You are an elite YouTube Shorts visual storyteller.
FORMAT: The Curious Warning.
HOOK: "Why you should be careful when you [perform normal action / visit normal place]."
BODY: Reveal 3 genuinely fascinating, mildly unsettling scientific facts about this normal thing.
- NUMBER ONE: The most fascinating scientific fact.
OUTRO: "Did you know this?"
SCRIPT RULES: Max 110 words total. Fast pacing. Full stops only. No commas. English only.`
  },
  {
    formatName: 'The Mythbuster',
    systemInstruction: `You are an elite YouTube Shorts visual storyteller.
FORMAT: The Mythbuster.
HOOK: "Most people are completely wrong about [common belief]."
BODY: Debunk the myth. Present 3 layers of truth, each more surprising than the last.
- NUMBER ONE TRUTH: The real scientific answer.
OUTRO: "What myth should we bust next?"
SCRIPT RULES: Max 110 words total. Fast pacing. Full stops only. No commas. English only.`
  },
  {
    formatName: 'The Hidden History',
    systemInstruction: `You are an elite YouTube Shorts visual storyteller.
FORMAT: The Hidden History.
HOOK: "The bizarre true story behind [historical event or object]."
BODY: Tell the story in 3 fast-paced acts. Each act reveals a surprising new detail.
- THE CLIMAX: The most unexpected final detail.
OUTRO: "Have you heard this story before?"
SCRIPT RULES: Max 110 words total. Fast pacing. Full stops only. No commas. English only.`
  },
  {
    formatName: 'Hidden Historical Truth',
    systemInstruction: `You are an elite YouTube Shorts visual storyteller.
FORMAT: Hidden Historical Truth.
HOOK: "Do you know the real reason why [historical event] happened?"
BODY: 3 shocking, lesser-known facts about a real historical figure or event.
OUTRO: "What else don't they teach us?"
SCRIPT RULES: Max 110 words. All facts must be real and verifiable. English only.`
  }
];

// Give Historical format 2x probability by adding it again
promptVault.push(promptVault[promptVault.length - 1]);

// ============================================================
// UNIVERSAL OUTPUT RULES (applied to every format)
// ============================================================
const UNIVERSAL_RULES = `
VISUAL PROMPT RULES (MANDATORY FOR ALL FORMATS):
- Generate exactly 8 to 10 visual scene objects — one for every few seconds of the script.
- Each scene MUST have an 'image_prompt' and a 'motion_prompt'.
- image_prompt: CRITICAL: Must start with 'Wide-angle establishing shot, subject fully visible from a distance, 35mm lens'. Focus on physical action only. Forbidden from textures, faces, close-ups.
- motion_prompt: A cinematic camera motion directive (e.g. 'Cinematic slow zoom in, fog rolling across the scene', 'Camera pans left, slow dolly forward', 'Handheld shake, subject approached from behind').
- DO NOT include specific named people, recognizable celebrities, or identifiable public figures.

SCRIPT RULES (MANDATORY):
- DO NOT include any spoken calls to action (like "subscribe", "like", or "comment"). The system handles this via a visual overlay.
- End the script smoothly with just the outro question.

OUTPUT FORMAT (CRITICAL):
Return ONLY a raw JSON object. No markdown. No code fences. No explanation text. Only JSON.
{
  "title": "High-energy viral YouTube title with a strong curiosity gap",
  "script": "Full spoken voiceover. Follows the selected format structure. Max 110 words. Full stops only.",
  "character_anchor": "A specific, highly detailed 1-sentence physical description of the primary subject that MUST appear in every visual (e.g., 'A single large brown eagle with a 2-meter wingspan', or 'Mahatma Gandhi in traditional white robes').",
  "global_style_anchor": "A highly detailed, 15-word visual style description (e.g., 'hyper-realistic 3D render, dark cinematic lighting, highly detailed textures' OR 'authentic 1890s black and white historical photograph')",
  "global_seed": 123456,
  "is_historical": false, 
  "historical_subject": "Only filled if format is Hidden Historical Truth, e.g., 'Mahatma Gandhi'",
  "search_queries": ["query1", "query2"], 
  "visuals": [
    { 
      "image_prompt": "Wide-angle establishing shot, subject fully visible from a distance, 35mm lens. Scene action description 1.", 
      "motion_prompt": "Cinematic slow zoom in, fog rolling across the scene",
      "search_query": "specific wikimedia commons search query for real photo if historical (otherwise omit)" 
    },
    { 
      "image_prompt": "Wide-angle establishing shot, subject fully visible from a distance, 35mm lens. Scene action description 2.", 
      "motion_prompt": "Camera pans left across the horizon" 
    }
  ],
  "tags": ["tag1","tag2","tag3","tag4","tag5"]
}`;

// ============================================================
// MAIN: GENERATE SCRIPT
// ============================================================
async function generateScript() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  // Action B: Randomly select one format from the vault on each execution
  let selectedFormat = promptVault[Math.floor(Math.random() * promptVault.length)];
  
  if (process.env.FORCE_HISTORICAL_MODE === 'true') {
    selectedFormat = promptVault.find(f => f.formatName === 'Hidden Historical Truth');
  }

  // Action D: Log the selected format
  log.info(`🎬 Selected Content Format: ${selectedFormat.formatName}`);

  // Action C: Inject selectedFormat.systemInstruction into the Gemini API call
  // Topic is NOT passed in — Gemini autonomously selects a unique, viral topic.
  const systemPrompt = `${selectedFormat.systemInstruction}

TOPIC SELECTION: Do NOT wait for a topic to be provided. Autonomously choose one highly unique, mind-blowing, or bizarre factual topic that is a perfect fit for the format above. Choose something that will make a viewer think "Wait, what?" — avoid anything generic. Surprise us.

${UNIVERSAL_RULES}`;

  log.info(`🎲 Letting Gemini autonomously choose topic and generate full package...`);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: {
          temperature: 0.95,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API failed: ${response.status} - ${await response.text()}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) throw new Error('Received empty response from Gemini API');

  try {
    const parsed = JSON.parse(rawText);

    // The script-writer no longer forcibly appends the '4k, hyper-realistic...' suffix
    // because the global_style_anchor handles the unified aesthetic across all scenes.

    log.info(`✅ Script package generated. Format: "${selectedFormat.formatName}", Visuals: ${parsed.visuals?.length}`);
    return parsed;
  } catch (error) {
    log.error(`Failed to parse JSON from Gemini. Raw: ${rawText.substring(0, 300)}`);
    throw new Error('LLM output was not valid JSON.');
  }
}

module.exports = { generateScript };
