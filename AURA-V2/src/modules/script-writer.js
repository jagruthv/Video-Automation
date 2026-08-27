/**
 * AURA-V2 Script Writer — The Triumvirate Pipeline (Production Grade)
 * 
 * 1. THE ARCHITECT: Viral Narratologist (Scripting)
 * 2. THE VISIONARY: Cinematic Prompt Engineer (Visuals)
 * 3. THE MARKETER: Growth & SEO Strategist (Metadata)
 */
require('dotenv').config();
const db = require('./db');

// Global Throttler State (30s gap between consecutive AI calls)
let lastGeminiCall = 0;
const GLOBAL_THROTTLE_MS = 15000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function throttleBrain() {
    const now = Date.now();
    const elapsed = now - lastGeminiCall;
    if (elapsed < GLOBAL_THROTTLE_MS) {
        const wait = GLOBAL_THROTTLE_MS - elapsed;
        console.log(`[BRAIN] 🕒 Global Throttle: Waiting ${Math.ceil(wait/1000)}s to stay within rate limits...`);
        await sleep(wait);
    }
    lastGeminiCall = Date.now();
}


// ─────────────────────────────────────────────────────────────────────────
// MODEL REGISTRY — verified live gen.pollinations.ai/v1/models + Gemini AI Studio
// ─────────────────────────────────────────────────────────────────────────

// Tier Group 1: Gemini (native API, GEMINI_API_KEY)
// 9 tiers verified live ai.google.dev June 2026
const GEMINI_TIERS = [
    'gemini-3.5-flash',                              // T1:  5 RPM / 250K TPM / 20 RPD
    'gemini-3.1-flash-lite',                         // T2: 15 RPM / 250K TPM / 500 RPD
    'gemini-3-flash-preview',                        // T3:  5 RPM / 250K TPM / 20 RPD
    'gemma-4-31b-it',                                // T4: 15 RPM / unlimited TPM / 1500 RPD
    'gemma-4-26b-a4b-it',                            // T5: 15 RPM / unlimited TPM / 1500 RPD
    'gemini-2.5-flash-lite',                         // T6: 10 RPM / 250K TPM / 20 RPD
    'gemini-2.5-flash',                              // T7:  5 RPM / 250K TPM / 20 RPD
    'gemini-3.1-flash-live-preview',                 // T8: unlimited RPM / 65K TPM / unlimited RPD
    'gemini-2.5-flash-native-audio-preview-12-2025', // T9: unlimited RPM / 1M TPM / unlimited RPD
];

// Tier Group 2: Polly (Pollinations AI, POLLINATIONS_BYOP_KEY)
// 14 highest-capacity text tiers — IDs verified live gen.pollinations.ai/v1/models June 2026
const POLLY_TEXT_TIERS = [
    'qwen-safety',       // Qwen3Guard 8B      — 250K capacity
    'nova-fast',         // Nova Micro          — 6900 capacity
    'mistral-small-3.2', // Mistral Small 3.2   — 4500 capacity
    'llama-scout',       // Llama 4 Scout       — 3400 capacity
    'mistral',           // Mistral Small 4     — 2800 capacity
    'qwen-coder',        // Qwen3 Coder 30B     — 2200 capacity
    'gemma',             // Gemma 4 26B A4B     — 2100 capacity
    'openai-fast',       // GPT-5.4 Nano        — 1800 capacity
    'qwen-vision',       // Qwen3 VL 30B        — 1600 capacity
    'openai',            // GPT-5 Nano          — 1300 capacity
    'llama',             // Llama 3.3 70B       — 1300 capacity
    'minimax-m2.7',      // MiniMax M2.7        — 1200 capacity
    'deepseek',          // DeepSeek V4 Flash   — 1100 capacity
    'step-3.5-flash',    // StepFun 3.5 Flash   — 1100 capacity
];


/**
 * UNIFIED MODEL ENGINE: Full cascade — Gemini (9) → Polly (14) → Groq → Cerebras → OpenRouter
 */
async function callUnifiedModel(prompt, systemRole = "Expert AI Assistant", agentLabel = "BRAIN") {
    // 30s Gap Protocol (v4.6)
    await throttleBrain();

    // Reinforce JSON-Strictness across all models
    const jsonDirective = "\n\nCRITICAL: YOU MUST RETURN ONLY VALID JSON. NO PRE-AMBLE, NO POST-AMBLE. DO NOT INCLUDE ANY MARKDOWN CODE BLOCKS. ENSURE ALL QUOTES ARE ESCAPED AND NO LITERAL NEWLINES ARE WITHIN STRINGS.";
    const hardenedSystemRole = `${systemRole}${jsonDirective}`;

    // ── Tier Group 1: Gemini (9 tiers, native API) ────────────────────────────
    for (let i = 0; i < GEMINI_TIERS.length; i++) {
        const model = GEMINI_TIERS[i];
        try {
            console.log(`[${agentLabel}] 🔗 Gemini tier ${i + 1}/9: ${model}`);
            const raw = await callGemini(model, `${hardenedSystemRole}\n\n${prompt}`);
            console.log(`[${agentLabel}] ✅ OK via Gemini/${model}`);
            return raw;
        } catch (e) {
            console.warn(`[${agentLabel}] ⚠️ Gemini/${model} failed: ${e.message}.`);
            if (i < GEMINI_TIERS.length - 1) {
                console.log(`[${agentLabel}] 🕒 Cooldown 15s before next Gemini tier...`);
                await sleep(15000);
            }
        }
    }
    console.warn(`[${agentLabel}] 🔄 All 9 Gemini tiers exhausted — cascading to Polly text overflow...`);

    // ── Tier Group 2: Polly text models (14 tiers, gen.pollinations.ai) ────────
    if (process.env.POLLINATIONS_BYOP_KEY) {
        for (let i = 0; i < POLLY_TEXT_TIERS.length; i++) {
            const model = POLLY_TEXT_TIERS[i];
            try {
                console.log(`[${agentLabel}] 🦜 Polly tier ${i + 1}/14: ${model}`);
                const raw = await callPollyText(model, hardenedSystemRole, prompt);
                console.log(`[${agentLabel}] ✅ OK via Polly/${model}`);
                return raw;
            } catch (e) {
                console.warn(`[${agentLabel}] ⚠️ Polly/${model} failed: ${e.message}.`);
            }
        }
        console.warn(`[${agentLabel}] 🔄 All 14 Polly tiers exhausted — cascading to Groq/Cerebras...`);
    }

    // ── Tier Group 3: Groq ───────────────────────────────────────────────────
    if (process.env.GROQ_API_KEY) {
        try {
            console.log(`[${agentLabel}] ⚡ Trying Groq llama-3.3-70b-versatile...`);
            const raw = await callGroq('llama-3.3-70b-versatile', hardenedSystemRole, prompt);
            console.log(`[${agentLabel}] ✅ OK via Groq/llama-3.3-70b`);
            return raw;
        } catch (e) {
            console.warn(`[${agentLabel}] ⚠️ Groq failed: ${e.message}.`);
        }
    }

    // ── Tier Group 4: Cerebras ───────────────────────────────────────────────
    if (process.env.CEREBRAS_API_KEY) {
        try {
            console.log(`[${agentLabel}] ⚡ Trying Cerebras llama3.1-70b...`);
            const raw = await callCerebras('llama3.1-70b', hardenedSystemRole, prompt);
            console.log(`[${agentLabel}] ✅ OK via Cerebras/llama3.1-70b`);
            return raw;
        } catch (e) {
            console.warn(`[${agentLabel}] ⚠️ Cerebras failed: ${e.message}.`);
        }
    }

    // ── Tier Group 5: OpenRouter ─────────────────────────────────────────────
    if (process.env.OPENROUTER_API_KEY) {
        try {
            console.log(`[${agentLabel}] 🌐 Trying OpenRouter meta-llama/llama-3.3-70b-instruct:free...`);
            const raw = await callOpenRouter('meta-llama/llama-3.3-70b-instruct:free', hardenedSystemRole, prompt);
            console.log(`[${agentLabel}] ✅ OK via OpenRouter`);
            return raw;
        } catch (e) {
            console.warn(`[${agentLabel}] ⚠️ OpenRouter failed: ${e.message}.`);
        }
    }

    throw new Error(`[${agentLabel}] ALL TIERS EXHAUSTED: Gemini×9 + Polly×14 + Groq + Cerebras + OpenRouter. Check quotas.`);
}

async function callGemini(modelName, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.95, topK: 60, topP: 0.98, maxOutputTokens: 8192, responseMimeType: "application/json" }
        })
    });
    const data = await response.json();
    if (data.error) { const err = new Error(data.error.message); err.status = data.error.code; throw err; }
    if (!data.candidates || !data.candidates[0].content) throw new Error("Gemini returned empty response (safety filter or capacity).");
    return data.candidates[0].content.parts[0].text;
}

async function callPollyText(modelName, system, prompt) {
    const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.POLLINATIONS_BYOP_KEY}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            temperature: 0.9,
            max_tokens: 8192
        })
    });
    if (!response.ok) throw new Error(`Polly HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    if (data.error) throw new Error(`Polly error: ${JSON.stringify(data.error)}`);
    if (!data.choices?.[0]?.message?.content) throw new Error('Polly returned empty response');
    return data.choices[0].message.content;
}

async function callOpenRouter(modelName, system, prompt) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://aura.automation',
            'X-Title': 'AURA'
        },
        body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        })
    });
    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    if (data.error) throw new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`);
    if (!data.choices?.[0]?.message?.content) throw new Error('OpenRouter returned empty response');
    return data.choices[0].message.content;
}

async function callGroq(modelName, system, prompt) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], response_format: { type: "json_object" } })
    });
    if (!response.ok) throw new Error(`Groq HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    if (data.error) throw new Error(`Groq API Error: ${data.error.message || JSON.stringify(data.error)}`);
    if (!data.choices?.[0]?.message?.content) throw new Error('Groq returned empty response');
    return data.choices[0].message.content;
}

async function callCerebras(modelName, system, prompt) {
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CEREBRAS_API_KEY}` },
        body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] })
    });
    if (!response.ok) throw new Error(`Cerebras HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    if (data.error) throw new Error(`Cerebras API Error: ${data.error.message || JSON.stringify(data.error)}`);
    if (!data.choices?.[0]?.message?.content) throw new Error('Cerebras returned empty response');
    return data.choices[0].message.content;
}

function extractJSON(rawText) {
    try {
        // 1. Strip markdown fences
        let text = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
        const start = text.indexOf('{'), end = text.lastIndexOf('}');
        if (start === -1) throw new Error('No JSON object found in response');
        let jsonStr = text.slice(start, end + 1);

        // 2. ROBUST SANITIZER: State-machine string cleaner
        // Walks char-by-char — handles escaped quotes, literal control chars inside strings.
        // The old regex /"([^"]*)"/ broke on image_prompts with 100+ words and special chars.
        let sanitized = '';
        let inString = false;
        let i = 0;
        while (i < jsonStr.length) {
            const ch = jsonStr[i];
            if (inString) {
                if (ch === '\\') {
                    // Pass escape sequences through unchanged
                    sanitized += ch + (jsonStr[i + 1] || '');
                    i += 2;
                    continue;
                } else if (ch === '"') {
                    inString = false;
                    sanitized += ch;
                } else if (ch === '\n') {
                    sanitized += '\\n'; // Escape literal newline inside string
                } else if (ch === '\r') {
                    sanitized += '\\r';
                } else if (ch === '\t') {
                    sanitized += '\\t';
                } else {
                    sanitized += ch;
                }
            } else {
                if (ch === '"') inString = true;
                sanitized += ch;
            }
            i++;
        }

        // 3. Remove trailing commas before ] or } (common LLM habit)
        sanitized = sanitized.replace(/,\s*([\]}])/g, '$1');

        return JSON.parse(sanitized);
    } catch (e) {
        console.error(`[BRAIN] ❌ JSON Extraction Failed: ${e.message}`);
        console.error(`[BRAIN] 📝 Raw Snippet (first 300 chars): ${rawText.slice(0, 300)}`);
        throw e;
    }
}

/**
 * AGENT 1: THE ARCHITECT (Scripting)
 */
async function architectScript(topic, manualScript, affiliateLink, contextPrompt, retryCount = 0, warehouseConfig = null) {
    const systemRole = "You are THE MASTER STORYTELLER, an elite author of suspenseful, captivating, and highly immersive fictional narratives. Your pacing is relentless, cinematic, and leaves the audience starving for what happens next.";
    
    let activeTopic = topic;
    
    // AI-Powered Dynamic Topic Engine — picks from 7 diverse content pillars on every run
    if (!activeTopic || (warehouseConfig && warehouseConfig.isWarehouse)) {
        const CONTENT_PILLARS = [
            {
                category: "Real Life Survival Story",
                instruction: "A true story of a real person who survived an extreme, unbelievable situation (avalanche, plane crash, solitary confinement, lost at sea, trapped underground, etc). Must name a real person or real documented event. First-person retelling."
            },
            {
                category: "Movie / TV Show Plot Breakdown",
                instruction: "A jaw-dropping breakdown of a famous movie or TV episode — focus on the most shocking, mind-bending twist or hidden detail the audience missed. Explain it in a way that makes them want to re-watch immediately. Choose from diverse films/shows across different genres and eras."
            },
            {
                category: "Real Crime Investigation",
                instruction: "A real documented criminal case — a cold case, a solved mystery, or an ongoing investigation. Retell it like a detective thriller. Focus on the key evidence, suspects, timeline, and the shocking resolution (or lack of one)."
            },
            {
                category: "Historical Mystery or Lost Civilization",
                instruction: "A real, unsolved historical mystery — a lost civilization, disappearance, ancient anomaly, or archaeological discovery that experts still cannot explain. Tell it dramatically with real details and conflicting theories."
            },
            {
                category: "Psychological Phenomenon or Experiment",
                instruction: "A real documented psychological experiment, disorder, or case study that reveals something disturbing or fascinating about the human mind. Examples: Stanford Prison, Milgram, real dissociative identity cases, cult psychology, sleep paralysis experiences."
            },
            {
                category: "Science Anomaly or Space Discovery",
                instruction: "A real, documented scientific anomaly, NASA finding, or physics paradox that scientists genuinely cannot fully explain yet. Keep it accessible, thrilling, and mind-expanding. Examples: WOW! Signal, Oumuamua, Fast Radio Bursts, the black hole at the center of the Milky Way."
            },
            {
                category: "Conspiracy Theory Deep-Dive (Presented as Investigation)",
                instruction: "Explore a well-known conspiracy theory by presenting BOTH sides — the evidence believers cite AND the official/scientific debunking. End with the viewer deciding. Examples: Bielefeld, MKUltra (confirmed), Tartaria, Flat Earth psychology. Never present it as fact, but as a journalistic investigation."
            },
            {
                category: "Real Life Drama & Betrayal",
                instruction: `A raw, first-person true-feeling story about real human betrayal — cheating spouses, family backstabbing, workplace betrayal, false friends. The narrator is the wronged person telling their story directly to the viewer.

STORY ARC RULES (MANDATORY):
1. HOOK: Open with the single most shocking moment — not the backstory. Drop the audience into the worst moment first.
2. CONTEXT: Briefly explain the relationship and what made the betrayal hit so hard.
3. THE DISCOVERY: The exact moment the narrator found out. Use sharp, painful sensory details — the sound of the wind, the timestamp on a phone screen, the silence in the room.
4. DIALOGUE SCENES: Include real back-and-forth dialogue. "I asked her. She looked away. I said: [exact words]. She said: [exact words]."
5. ALLIES & BETRAYERS: Show who stood by the narrator (loyal son, old friend) and who didn't (daughter who sided with the cheater, etc.).
6. THE LOW POINT: One scene where the narrator felt utterly alone. Be specific with place and weather — rain, cold wind, empty apartment.
7. KARMA ARC: The betrayer's life deteriorates naturally — not through revenge, just consequences catching up. Show this briefly in the final third.
8. THE COMEBACK: The narrator's life quietly improves — not through chasing it, but through it finding them. A new person enters naturally (random encounter — not the narrator's effort). Good things returning to good people.
9. ENDING: Reflective but NOT sad. A statement of quiet strength the viewer can share in the comments.

VOICE: Raw, honest, conversational — like a real person venting, not an author writing fiction. Short sentences. Pauses. Real emotion. Include at least 3 dialogue exchanges. Include at least 2 atmospheric details (weather, location, time of day).`
            }
        ];

        // Pick a category that hasn't shown up recently in DB history
        const recentTopics = db.getRecentTopics(30).join(' ').toLowerCase();
        
        // Shuffle pillars and pick the first one that doesn't feel overused
        const shuffled = CONTENT_PILLARS.sort(() => Math.random() - 0.5);
        const chosen = shuffled.find(p => !recentTopics.includes(p.category.split(' ')[0].toLowerCase())) || shuffled[0];
        
        const randomSeed = Math.floor(Math.random() * 999999);
        
        // Use LLM to dynamically generate a fresh specific topic within the chosen category
        console.log(`[ARCHITECT] 🎲 Auto-selecting topic from pillar: "${chosen.category}"...`);
        let dynamicTopic = null;
        try {
            const topicPickerUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
            const topicPickerRes = await fetch(topicPickerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `You are a viral YouTube content strategist. Suggest ONE specific, highly engaging topic for a short video in this category: "${chosen.category}".

Category instructions: ${chosen.instruction}

ALREADY USED (avoid these): ${db.getRecentTopics(90).slice(0, 20).join(', ')}

Rules:
- Must be a REAL, specific subject (a real person's name, a real movie title, a real event, etc.)
- Must be globally interesting, not region-specific
- Must have high emotional resonance or shocking value
- Return ONLY the topic as a single sentence. No explanation. No JSON. No markdown.
Random seed: ${randomSeed}` }] }],
                    generationConfig: { temperature: 1.0, maxOutputTokens: 80 }
                })
            });
            if (topicPickerRes.ok) {
                const topicData = await topicPickerRes.json();
                const raw = topicData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (raw && raw.length > 10) {
                    dynamicTopic = raw.replace(/^["']|["']$/g, '').trim();
                    console.log(`[ARCHITECT] ✅ Dynamic topic selected: "${dynamicTopic}"`);
                }
            }
        } catch(e) {
            console.warn(`[ARCHITECT] ⚠️ Topic picker failed: ${e.message}. Using fallback.`);
        }
        
        const isDramaPillar = chosen.category === 'Real Life Drama & Betrayal';
        activeTopic = dynamicTopic 
            ? `CATEGORY: ${chosen.category}\nTOPIC: ${dynamicTopic}\nSTYLE GUIDE: ${chosen.instruction}`
            : `CATEGORY: ${chosen.category}\nSTYLE GUIDE: ${chosen.instruction}\n(Random Seed: ${randomSeed})`;
        
        // Inject drama-specific arc constraint into the shared activeTopic context
        if (isDramaPillar) {
            activeTopic += `\n\nDRAMA ARC ENFORCEMENT:
- Scene 1: DROP INTO the worst moment (not backstory). Shocking, specific, immediate.
- Scenes 2-5: Who is the narrator, what was the relationship, why did it hurt so much.
- Scenes 6-10: The discovery. The confrontation. The dialogue (use quotes: "I said / she said").
- Scenes 11-14: The low point. Allies who stayed. Betrayers who left. Weathered, lonely details.
- Scenes 15-18: The betrayer's karma — slow, natural consequences. No revenge.
- Scenes 19+: The narrator's quiet comeback. Something good entering WITHOUT effort.
- FINAL SCENE: A reflective, shareable one-liner. Not sad — quietly powerful.`;
        }

        // Stamp pillar so downstream engines (audio/music) can read it
        activeTopic = activeTopic + `\n\n[_PILLAR_:${chosen.category}]`;
    }
    
    // Self-Healing Strategy: Stricter instruction on retry
    const strictnessHook = retryCount > 0 ? "\n\nCRITICAL: YOUR PREVIOUS OUTPUT HAD INVALID JSON. RETURN PERFECT, RAW JSON ONLY. NO OTHER TEXT. DO NOT USE LITERAL NEWLINES INSIDE QUOTES." : "";
    
    const userTopicOverride = topic ? `
══════════════════════════════════════════════════════
⚠️  STRICT OPERATOR OVERRIDE — NON-NEGOTIABLE ⚠️
══════════════════════════════════════════════════════
The operator has MANUALLY specified the following topic. You MUST write your script about THIS EXACT subject.
DO NOT substitute, rephrase into a different topic, or make up a new one.
DO NOT let the style guides or pillars below override this.

OPERATOR TOPIC: "${topic}"
══════════════════════════════════════════════════════
` : '';

    const prompt = `
        ${userTopicOverride}
        TASK: Architect a High-Retention Elite Cinematic Story Script for Short-Form Video.
        TOPIC: ${activeTopic}
        ${manualScript ? `REQUIREMENTS: ${manualScript}` : ""}
        ${contextPrompt ? `CONTEXT: ${contextPrompt}` : ""}
        
        LETHAL CONSTRAINTS:
        - HOOK (Scene 1): The opening narration MUST be a shocking statement, uncomfortable question, or jaw-dropping reveal. It must make someone STOP scrolling in 3 seconds. Example: "He cut off his own arm. And he smiled doing it." or "She remembered dying. She was 4 years old."
        - OPEN LOOP (Final Scene): The script MUST end with an unanswered emotional question, cliffhanger, or invitation to debate. This drives comments and rewatch.
        - PACING: The last 4 scenes must escalate tension relentlessly — no slow-down at the end.
        - UNIQUENESS PROTOCOL (90-DAY MEMORY): Do NOT generate a premise similar to: ${db.getRecentTopics(90).slice(0, 30).join(', ')}. Keep it extremely fresh!
        - WORD COUNT: Script must be 250-400 words total. Every word must earn its place — no filler.
        - SCENES: MINIMUM 16 scenes, MAXIMUM 30 scenes. Split text into SHORT punchy scenes of 12-18 words narration each.
        - STRUCTURE: Write a tense, edge-of-your-seat narrative. For DRAMA/BETRAYAL stories: use first-person dialogue (\"I said...\", \"She said...\"), atmospheric details (weather, time of day, silence), and a karma arc. For all other stories: focus on mystery, stakes, and an incredible plot twist. NEVER use \"List\" or \"Countdown\" formats!
        - PACING: Each scene narration MUST be 12-16 words max — never more. Cut mercilessly.
        ${affiliateLink ? `- CTA: Include a natural audio CTA in the final scene: ${affiliateLink}` : ""}
        
        RETURN JSON:
        {
          "core_entity": "1-2 word topic subject",
          "global_seed": 12345,
          "scenes": [
            { 
              "narration": "Detailed scene narration (target 10-15 words per scene)", 
              "visual_logic": "Hyper-realistic documentary visual concept",
              "real_world_subject": "FILL with the exact real-world place/event name (e.g. 'Taj Mahal', 'Kumbh Mela', 'Tirupati Temple', 'Eiffel Tower') ONLY when the scene explicitly depicts a real, identifiable landmark or historical event. Set to null for abstract, fictional, or conceptual visuals."
            }
          ]
        }
    ${strictnessHook}`;

    try {
        const res = await callUnifiedModel(prompt, systemRole, 'ARCHITECT');
        const parsed = extractJSON(res);
        // Extract embedded pillar tag from activeTopic and stamp on result
        const pillarMatch = activeTopic.match(/\[_PILLAR_:([^\]]+)\]/);
        if (pillarMatch) parsed._pillar = pillarMatch[1].trim();
        return parsed;
    } catch (e) {
        if (retryCount < 2) {
            console.warn(`[ORCHESTRATOR] ⚠️ Architect JSON failed. Self-healing retry ${retryCount + 1}/2...`);
            await sleep(2000);
            return architectScript(topic, manualScript, affiliateLink, contextPrompt, retryCount + 1, warehouseConfig);
        }
        throw e;
    }
}

/**
 * AGENT 2: THE VISIONARY (Prompts)
 */
async function visionaryPrompts(scriptBlueprint, retryCount = 0) {
    const systemRole = "You are THE VISIONARY, an Expert AI Cinematographer. You specialize in Midjourney/Stable Diffusion prompting for high-end cinematic visuals.";
    
    const strictnessHook = retryCount > 0 ? "\n\nCRITICAL: YOUR PREVIOUS OUTPUT HAD INVALID JSON. RETURN PERFECT, RAW JSON ONLY. NO OTHER TEXT. DO NOT USE LITERAL NEWLINES INSIDE QUOTES." : "";

    const prompt = `
        TASK: Generate exact video and image prompts iteratively for the following script.
        SCRIPTBlueprint: ${JSON.stringify(scriptBlueprint.scenes)}
        
        VISUAL STYLE: Ultra-high-action cinematic shot, 35mm anamorphic lens, hyper-realistic, vivid colors, deep shadows, 8k resolution.
        HARDENING: Add negative keywords implicitly: "No blur, no low-res, no distortion, no glitchy limbs."
        MANDATORY KEYWORDS: Anamorphic lenses, Volumetric Tyndall effects, Unreal Engine 5 render style, Ray Tracing, photorealistic.
        
        INSTRUCTIONS:
        1. 'image_prompt' MUST describe the static aesthetic and composition of a single perfect freeze-frame.
        2. 'video_prompt' MUST read like a direct imperative describing exactly how that image should transition or move (e.g. "Slow orbital pan right, particles floating").
        
        RETURN JSON:
        {
          "scenes": [
            { "image_prompt": "30-50 words: cinematic style + key subject + lighting + mood. No markdown, no newlines.", "video_prompt": "One sentence camera motion imperative (e.g. Slow orbital pan right, particles floating)." }
          ]
        }
    ${strictnessHook}`;

    try {
        const res = await callUnifiedModel(prompt, systemRole, 'VISIONARY');
        return extractJSON(res);
    } catch (e) {
        if (retryCount < 2) {
            console.warn(`[ORCHESTRATOR] ⚠️ Visionary JSON failed. Self-healing retry ${retryCount + 1}/2...`);
            await sleep(2000);
            return visionaryPrompts(scriptBlueprint, retryCount + 1);
        }
        throw e;
    }
}

/**
 * AGENT 3: THE MARKETER (SEO)
 */
async function marketerMetadata(scriptBlueprint) {
    const systemRole = "You are THE MARKETER, a Viral Growth Strategist. You specialize in CTR optimization for Indian YouTube audiences.";
    const prompt = `
        TASK: Generate high-CTR metadata AND a Clickbait Thumbnail Prompt for: ${scriptBlueprint.core_entity}.
        SCRIPT: ${scriptBlueprint.scenes[0].narration.slice(0, 50)}...
        
        RULES:
        - TITLE: Clickbait English, triggering deep curiosity.
        - DESCRIPTION: 500-800 words. **STRICTLY PROFESSIONAL ENGLISH ONLY**. No Hindi/Hinglish/Tenglish. Use a natural 3-paragraph SEO-rich structure. Convince them to SUBSCRIBE.
        - TAGS: EXACTLY 20 viral niche tags.
        - THUMBNAIL_PROMPT: A hyper-detailed FLUX/SD prompt. Focus on 'Curiosity Gap' visual elements, extreme contrast, and expressive subjects.
        
        RETURN JSON:
        { "title": "...", "description": "...", "hashtags": [], "tags": [], "thumbnail_prompt": "..." }
    `;
    const res = await callUnifiedModel(prompt, systemRole, 'MARKETER');
    return extractJSON(res);
}

async function generateScript(topic, script, affiliateLink, contextPrompt, retryContext = null, warehouseConfig = null) {
    console.log(`[TRIUMVIRATE] 🏰 Activating THE ARCHITECT...`);
    const architectResult = await architectScript(topic, script, affiliateLink, contextPrompt, retryContext ? 1 : 0, warehouseConfig);
    
    console.log(`[TRIUMVIRATE] 👁️ Activating THE VISIONARY...`);
    const visionaryResult = await visionaryPrompts(architectResult);

    console.log(`[TRIUMVIRATE] 📊 Activating THE MARKETER...`);
    const marketerResult = await marketerMetadata(architectResult);

    // Merge results into valid AURA Blueprint
    const fullBlueprint = {
        ...architectResult,
        ...marketerResult,
        scenes: architectResult.scenes.map((s, i) => ({
            ...s,
            ...(visionaryResult.scenes[i] || visionaryResult.scenes[0])
        }))
    };

    console.log(`[TRIUMVIRATE] ✅ Production-Level Blueprint Finalized: "${fullBlueprint.title}"`);
    return fullBlueprint;
}

/**
 * UTILITY: Pexels Search Architect (Condenser)
 * Uses a direct fetch — bypasses callUnifiedModel's JSON directive
 * which forces all models to return {"keywords":[...]} instead of plain text.
 */
async function architectSearchQuery(fullPrompt) {
    try {
        console.log(`[PULSE] \ud83e\udde0 Condensing prompt for Pexels stock search...`);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Extract 3-4 English stock video search keywords from this prompt. Return ONLY the keywords separated by spaces. No JSON, no punctuation, no explanation.\n\nPROMPT: ${fullPrompt.slice(0, 300)}\n\nKEYWORDS:` }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 30 }
            })
        });

        if (response.ok) {
            const data = await response.json();
            let raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

            // Guard: if model returned JSON anyway, extract values
            if (raw.startsWith('{') || raw.startsWith('[')) {
                try {
                    const parsed = JSON.parse(raw);
                    const vals = parsed.keywords || parsed.query || Object.values(parsed).flat();
                    raw = Array.isArray(vals) ? vals.slice(0, 4).join(' ') : String(vals);
                } catch (_) {
                    raw = raw.replace(/[{}\[\]"]/g, ' ').replace(/keywords?:/gi, '').trim();
                }
            }

            const clean = raw.replace(/["{}.[\]]/g, '').replace(/\s+/g, ' ').trim();
            if (clean.length > 3) {
                console.log(`[PULSE] \u2705 Keywords extracted: "${clean}" (via gemini-3.1-flash-lite-preview)`);
                return clean;
            }
        }

        console.warn(`[PULSE] \u26a0\ufe0f Keyword condensation returned empty result. Falling back to Core Entity.`);
        return null;
    } catch (e) {
        console.warn(`[PULSE] \u26a0\ufe0f Search Architect error: ${e.message}. Falling back to Core Entity.`);
        return null;
    }
}

module.exports = { generateScript, architectSearchQuery, extractJSON, callUnifiedModel };
