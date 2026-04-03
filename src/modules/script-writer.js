'use strict';

const { getModuleLogger } = require('../utils/logger');
const log = getModuleLogger('script-writer');

/**
 * Generate a single JSON package containing script, visuals, title, and tags
 * using the Gemini API.
 */
async function generateScript(topic) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const systemPrompt = `You are a viral YouTube Shorts creator. 
Topic: ${topic}. 
Generate a 45-second script (max 115 words), 8 cinematic visual prompts for Veo 3.1, a YouTube title, and 10 tags. 
Return ONLY raw JSON in this exact structure:
{
  "title": "High energy YouTube title",
  "script": "The spoken voiceover script, max 115 words. No commas, full stops only.",
  "visuals": [
    "cinematic prompt 1", 
    "cinematic prompt 2",
    "cinematic prompt 3",
    "cinematic prompt 4",
    "cinematic prompt 5",
    "cinematic prompt 6",
    "cinematic prompt 7",
    "cinematic prompt 8"
  ],
  "tags": ["tag1", "tag2", "tag3"]
}`;

  log.info(`Generating script via Gemini for topic: "${topic}"`);

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API failed: ${response.status} - ${await response.text()}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!rawText) throw new Error('Received empty response from Gemini API');

  try {
    const parsed = JSON.parse(rawText);
    log.info(`✅ Script package successfully generated.`);
    return parsed;
  } catch (error) {
    log.error(`Failed to parse JSON from Gemini. Raw output: ${rawText}`);
    throw new Error('LLM output was not valid JSON.');
  }
}

module.exports = { generateScript };
