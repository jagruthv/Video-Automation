'use strict';

const { getModuleLogger } = require('../utils/logger');
const log = getModuleLogger('script-writer');

/**
 * Generate a full "Countdown Fact" YouTube Shorts package via Gemini.
 * Structure: Hook → Fact 3 → Fact 2 → CTA Interrupt → Fact 1 → Outro
 */
async function generateScript(topic) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const systemPrompt = `You are an elite YouTube Shorts viral strategist. Your mission is to create a "Countdown Facts" short in the style of Zack D. Films — fast, shocking, and impossible to skip.

TOPIC: ${topic}

FORMAT RULES:
- Hook (0–3s): One bold, alarming statement that demands attention. No fluff.
- Fact 3: A genuinely surprising fact. Punchy, 1–2 sentences max.
- Fact 2: Even more surprising. One sentence.
- CTA Interrupt: A quick 3-second spoken interrupt — "Before number 1, hit subscribe if you didn't know this!"
- Fact 1 (THE CLOSER): The most shocking, jaw-dropping fact. This is the one viewers will screenshot.
- Outro: One short engagement question to drive comments (e.g., "Which one got you?")

SCRIPT RULES:
- Maximum 115 words total spoken voiceover.
- No commas in the script. Use full stops only.
- Write numbers as words (e.g., "three" not "3").
- Language: English ONLY.

VISUAL PROMPT RULES:
- Generate exactly 6 to 8 hyper-literal Veo 3.1 video prompts — one per scene section.
- Each visual prompt MUST be a vivid, cinematic, real-world scene directly visualizing what is being said.
- Anonymous human body parts (eyes, hands, silhouettes, POV shots) are ALLOWED and encouraged for hyper-literal storytelling.
- CRITICAL SAFETY: Do NOT include specific named people, celebrities, or recognizable public figures. No faces that could be identified.
- CRITICAL FORMAT: Every single visual prompt MUST end with exactly this phrase: "4k, hyper-realistic, slow pan right"
- Use diverse shot styles: macro lens, POV, silhouette, extreme close-up, 3D abstract render, aerial shot.

Return ONLY a raw JSON object in this exact structure with no markdown, no code fences:
{
  "title": "High-energy viral YouTube title with a curiosity gap",
  "script": "Full spoken voiceover, max 140 words, full stops only. Include countdown labels: Number three, Number two, Number one.",
  "visuals": [
    "Hyper-realistic cinematic macro scene for Hook. 4k, hyper-realistic, slow pan right",
    "Cinematic scene for Fact 3 intro. 4k, hyper-realistic, slow pan right",
    "Cinematic scene for Fact 3 explanation. 4k, hyper-realistic, slow pan right",
    "Cinematic scene for Fact 2 intro. 4k, hyper-realistic, slow pan right",
    "Cinematic scene for Fact 2 explanation. 4k, hyper-realistic, slow pan right",
    "Glowing red subscribe button floating in dark digital space, pressed by glass cursor, explosive sparks on impact. 4k, hyper-realistic, slow pan right",
    "Most visually striking scene for Fact 1 reveal. 4k, hyper-realistic, slow pan right",
    "Eerie atmospheric closing scene that matches Fact 1 explanation. 4k, hyper-realistic, slow pan right"
  ],
  "tags": ["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10"]
}`;

  log.info(`Generating Countdown Fact script via Gemini for topic: "${topic}"`);

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

    // Validate that all 5 visual prompts end with the required suffix
    if (Array.isArray(parsed.visuals)) {
      parsed.visuals = parsed.visuals.map((v, i) => {
        const trimmed = v.trim();
        if (!trimmed.endsWith('4k, hyper-realistic, slow pan right')) {
          log.warn(`Visual ${i + 1} missing required suffix — appending.`);
          return trimmed + '. 4k, hyper-realistic, slow pan right';
        }
        return trimmed;
      });
    }

    log.info(`✅ Countdown Fact script package generated. Visuals: ${parsed.visuals?.length}`);
    return parsed;
  } catch (error) {
    log.error(`Failed to parse JSON from Gemini. Raw: ${rawText.substring(0, 300)}`);
    throw new Error('LLM output was not valid JSON.');
  }
}

module.exports = { generateScript };
