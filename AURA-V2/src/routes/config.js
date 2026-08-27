'use strict';
/**
 * AURA-V2: Config Routes — /api/config/*
 * Runtime LLM priority management and persisted config updates.
 */
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');

function persistEnvKey(key, value) {
    try {
        let envData = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envData)) {
            envData = envData.replace(regex, `${key}=${value}`);
        } else {
            envData += `\n${key}=${value}\n`;
        }
        fs.writeFileSync(ENV_PATH, envData);
    } catch (e) {
        console.error(`[CONFIG] ⚠️ Failed to persist ${key} to .env: ${e.message}`);
    }
}

// GET /api/config/llm-priority
router.get('/llm-priority', (req, res) => {
    const priority = process.env.LLM_PRIORITY
        || 'gemini-3.1-flash-lite-preview,llama-3.3-70b-versatile,llama3.1-70b,gemini-2.5-flash';
    res.json({ priorityStr: priority });
});

// POST /api/config/llm-priority
router.post('/llm-priority', (req, res) => {
    const { priorityStr } = req.body;
    if (!priorityStr) return res.status(400).json({ error: 'priorityStr is required' });

    process.env.LLM_PRIORITY = priorityStr;
    persistEnvKey('LLM_PRIORITY', priorityStr);
    console.log(`[SYS] ⚙️ LLM Priority updated: ${priorityStr}`);
    res.json({ success: true, priorityStr });
});

module.exports = router;
