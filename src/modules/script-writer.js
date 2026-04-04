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
  }
];

// ============================================================
// UNIVERSAL OUTPUT RULES (applied to every format)
// ============================================================
const UNIVERSAL_RULES = `
VISUAL PROMPT RULES (MANDATORY FOR ALL FORMATS):
- Generate exactly 8 to 10 hyper-literal Veo 3.1 video prompts — one for every few seconds of the script.
- We need rapid visual changes! A new visual prompt every 10-15 words.
- Each visual prompt MUST directly visualize what is being said in that moment of the script.
- Anonymous human body parts (eyes, hands, silhouettes, POV shots, extreme close-ups) are ALLOWED.
- DO NOT include specific named people, recognizable celebrities, or identifiable public figures.
- Use diverse shot styles: macro lens, POV, silhouette, aerial, 3D abstract render, extreme close-up.
- CRITICAL FORMAT RULE: Every single visual prompt MUST end with the exact phrase: "4k, hyper-realistic, slow pan right"

SCRIPT RULES (MANDATORY):
- DO NOT include any spoken calls to action (like "subscribe", "like", or "comment"). The system handles this via a visual overlay.
- End the script smoothly with just the outro question.

OUTPUT FORMAT (CRITICAL):
Return ONLY a raw JSON object. No markdown. No code fences. No explanation text. Only JSON.
{
  "title": "High-energy viral YouTube title with a strong curiosity gap",
  "script": "Full spoken voiceover. Follows the selected format structure. Max 110 words. Full stops only.",
  "visuals": [
    "Hyper-literal cinematic scene for beat 1. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for beat 2. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for beat 3. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for beat 4. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for beat 5. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for beat 6. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for beat 7. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for beat 8. 4k, hyper-realistic, slow pan right"
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
  const selectedFormat = promptVault[Math.floor(Math.random() * promptVault.length)];

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

    // Enforce the required suffix on every visual prompt as a post-processing guard
    if (Array.isArray(parsed.visuals)) {
      parsed.visuals = parsed.visuals.map((v, i) => {
        const trimmed = (v || '').trim();
        if (!trimmed.endsWith('4k, hyper-realistic, slow pan right')) {
          log.warn(`Visual ${i + 1} missing required suffix — appending.`);
          return trimmed + '. 4k, hyper-realistic, slow pan right';
        }
        return trimmed;
      });
    }

    log.info(`✅ Script package generated. Format: "${selectedFormat.formatName}", Visuals: ${parsed.visuals?.length}`);
    return parsed;
  } catch (error) {
    log.error(`Failed to parse JSON from Gemini. Raw: ${rawText.substring(0, 300)}`);
    throw new Error('LLM output was not valid JSON.');
  }
}

module.exports = { generateScript };
