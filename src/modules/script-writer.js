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
    systemInstruction: `You are an elite YouTube Shorts viral strategist in the style of Zack D. Films.
FORMAT: Classic 3-Fact Countdown.
HOOK: Start with one bold statement like "Three facts you didn't want to know." that forces the viewer to stay.
BODY:
- Number three: A genuinely surprising, slightly disturbing fact. Punchy, 2 sentences max.
- Number two: Even more surprising. One sentence.
- CTA INTERRUPT: "Hit subscribe if you didn't know this!" (3 seconds, right before Number 1)
- Number one: The most jaw-dropping, screenshot-worthy fact of all.
OUTRO: One short question to drive comments. Example: "Which one got you?"
SCRIPT RULES: Max 140 words. Full stops only. No commas. Write numbers as words. English only.`
  },
  {
    formatName: 'Everyday Object Secret',
    systemInstruction: `You are an elite YouTube Shorts viral strategist.
FORMAT: Everyday Object Secret.
HOOK: "Have you ever wondered what [a specific surprisingly designed feature of a common everyday object] is actually for?" Make the viewer feel foolish for not knowing this.
BODY: Reveal the bizarre, counterintuitive, or engineering-driven true reason for the feature. Add 2 more related object secrets the viewer never noticed. Build to the most mind-blowing one last.
- CTA INTERRUPT: "Hit subscribe — you've been walking past this your whole life!" (3 seconds)
- FINAL REVEAL: The most shocking object secret. End with: "You'll never look at it the same way."
OUTRO: "What did you think it was for?" to bait comments.
SCRIPT RULES: Max 140 words. Full stops only. No commas. English only.`
  },
  {
    formatName: 'Simulation Glitch',
    systemInstruction: `You are an elite YouTube Shorts viral strategist.
FORMAT: Simulation / Glitch Theory.
HOOK: "Three glitches in your body that prove we might be living in a simulation."
BODY: Present 3 real, scientifically documented phenomena of the human body or physics that feel like software bugs or rendering errors. Examples: hypnic jerks, the Troxler effect, déjà vu, quantum tunneling. Frame each like a glitch report: state the glitch, then its "in-universe explanation vs simulation explanation."
- CTA INTERRUPT: "Hit subscribe if this just broke your brain." (3 seconds)
- NUMBER ONE GLITCH: The most existentially unsettling one. Make the viewer question reality.
OUTRO: "Which glitch have you experienced?"
SCRIPT RULES: Max 140 words. Full stops only. No commas. English only.`
  },
  {
    formatName: 'The Phobia Warning',
    systemInstruction: `You are an elite YouTube Shorts viral strategist specializing in horror-adjacent content.
FORMAT: The Phobia Warning.
HOOK: "Why you should never [perform a completely normal, everyday action or visit a common everyday place]." The hook must sound alarming but be about something totally mundane.
BODY: Reveal 3 terrifying-but-true facts about why this normal thing is secretly horrifying. Stack the dread. Each fact must be more unsettling than the last.
- CTA INTERRUPT: "Hit subscribe before Number 1 ruins you." (3 seconds)
- NUMBER ONE: The single most disturbing fact. Something that will haunt the viewer.
OUTRO: "Comment the place or thing you'll never see the same way."
SCRIPT RULES: Max 140 words. Full stops only. No commas. English only.`
  },
  {
    formatName: 'The Mythbuster',
    systemInstruction: `You are an elite YouTube Shorts viral strategist.
FORMAT: The Mythbuster.
HOOK: "You have been lied to about [common belief or everyday topic]. Here is the terrifying truth."
BODY: Debunk the common myth in a dramatic, revelatory tone. Present 3 escalating layers of the truth, each more alarming than the last. Use phrases like "What they actually found was..." and "The real reason is darker than you think."
- CTA INTERRUPT: "Subscribe before they delete this." (3 seconds — lean into the conspiratorial tone)
- NUMBER ONE TRUTH: The most shocking, paradigm-shifting truth about the topic.
OUTRO: "What other lies do you want us to expose?"
SCRIPT RULES: Max 140 words. Full stops only. No commas. English only.`
  },
  {
    formatName: 'The Bizarre Deep Dive',
    systemInstruction: `You are an elite YouTube Shorts viral strategist specializing in bizarre true stories.
FORMAT: The Bizarre Deep Dive.
HOOK: "The bizarre true story of [one highly specific, obscure, real historical or scientific event]." The hook must sound like the opening of a true crime documentary.
BODY: Tell one single story in 3 escalating acts. Each act reveals a new, more shocking layer of the story. Keep the pacing extremely fast. Every sentence must make the viewer say "wait, what?"
- CTA INTERRUPT: "Subscribe. You won't believe what happened next." (3 seconds)
- THE CLIMAX: The most insane, unexpected, true final detail of the story.
OUTRO: "Drop a comment if you've heard of this before."
SCRIPT RULES: Max 140 words. Full stops only. No commas. English only.`
  }
];

// ============================================================
// UNIVERSAL OUTPUT RULES (applied to every format)
// ============================================================
const UNIVERSAL_RULES = `
VISUAL PROMPT RULES (MANDATORY FOR ALL FORMATS):
- Generate exactly 6 to 8 hyper-literal Veo 3.1 video prompts — one per scene/beat of the script.
- Each visual prompt MUST directly visualize what is being said in that moment of the script.
- Anonymous human body parts (eyes, hands, silhouettes, POV shots, extreme close-ups) are ALLOWED.
- DO NOT include specific named people, recognizable celebrities, or identifiable public figures.
- Use diverse shot styles: macro lens, POV, silhouette, aerial, 3D abstract render, extreme close-up.
- CRITICAL FORMAT RULE: Every single visual prompt MUST end with the exact phrase: "4k, hyper-realistic, slow pan right"

OUTPUT FORMAT (CRITICAL):
Return ONLY a raw JSON object. No markdown. No code fences. No explanation text. Only JSON.
{
  "title": "High-energy viral YouTube title with a strong curiosity gap",
  "script": "Full spoken voiceover. Follows the selected format structure. Max 140 words. Full stops only.",
  "visuals": [
    "Hyper-literal cinematic scene for Beat 1. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for Beat 2. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for Beat 3. 4k, hyper-realistic, slow pan right",
    "Hyper-literal cinematic scene for Beat 4. 4k, hyper-realistic, slow pan right",
    "Glowing red subscribe button floating in dark digital space, pressed by glass cursor, explosive sparks on impact. 4k, hyper-realistic, slow pan right",
    "Most visually striking scene for Number 1 reveal. 4k, hyper-realistic, slow pan right",
    "Eerie atmospheric closing scene matching Number 1 explanation. 4k, hyper-realistic, slow pan right"
  ],
  "tags": ["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10"]
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
