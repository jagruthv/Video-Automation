'use strict';
/**
 * AURA-V2 Startup Config Validator
 *
 * Validates required environment variables on boot and prints a clear
 * API status table. Throws only on truly critical missing vars.
 *
 * require() this at the very top of server.js.
 */

const REQUIRED = [
    { key: 'GEMINI_API_KEY',   label: 'Gemini AI',        critical: true  },
];

const OPTIONAL = [
    { key: 'GROQ_API_KEY',     label: 'Groq (LLaMA)'                      },
    { key: 'CEREBRAS_API_KEY', label: 'Cerebras (LLaMA)'                  },
    { key: 'YT_CLIENT_ID',     label: 'YouTube API'                        },
    { key: 'YT_REFRESH_TOKEN', label: 'YouTube Auth'                       },
    { key: 'PEXELS_API_KEY',   label: 'Pexels Images'                      },
    { key: 'FISH_SPEECH_URL',  label: 'Fish Speech TTS'                    },
    { key: 'POLLINATIONS_BYOP_KEY', label: 'Pollinations BYOP'                  },
    { key: 'AUTH_ENABLED',     label: 'Auth Layer',       defaultVal: 'false' },
];

function check() {
    const missing = REQUIRED.filter(r => !process.env[r.key]);
    if (missing.length > 0) {
        const keys = missing.map(r => r.key).join(', ');
        throw new Error(`[CONFIG] ❌ Critical env vars missing: ${keys}. Check your .env file.`);
    }

    console.log('\n┌──────────────────────────────────────────┐');
    console.log('│        AURA-V2 API Status Matrix         │');
    console.log('├──────────────────────────────────────────┤');

    const all = [...REQUIRED, ...OPTIONAL];
    for (const item of all) {
        const present = !!process.env[item.key];
        const icon    = present ? '✅' : (item.critical ? '❌' : '⬜');
        const status  = present ? 'ACTIVE' : (item.defaultVal ? `DEFAULT: ${item.defaultVal}` : 'NOT SET');
        const label   = item.label.padEnd(22);
        console.log(`│ ${icon} ${label} ${status.padEnd(16)} │`);
    }

    console.log('└──────────────────────────────────────────┘\n');
}

check();
