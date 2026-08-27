'use strict';
/**
 * AURA-V2: JWT Auth Middleware
 *
 * INACTIVE by default — set AUTH_ENABLED=true in .env to activate.
 * When inactive, every request is treated as an authenticated free-plan user.
 *
 * When active:
 *   - Expects: Authorization: Bearer <jwt>
 *   - JWT payload: { userId, plan: 'free'|'pro'|'enterprise', email }
 *   - Sets req.user on success; returns 401 on invalid/missing token
 *
 * To generate tokens, call signToken() from your auth controller.
 */
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'aura-v2-dev-secret-change-in-production';

// ── Minimal JWT implementation (no external dep) ────────────────────────────
function b64url(str) { return Buffer.from(str).toString('base64url'); }
function b64decode(str) { return Buffer.from(str, 'base64url').toString('utf8'); }

function signToken(payload, expiresInSeconds = 86400) {
    const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body    = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }));
    const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
    const parts = (token || '').split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (expected !== sig) throw new Error('Invalid signature');
    const payload = JSON.parse(b64decode(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return payload;
}

// ── Express Middleware ────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    // Bypass mode — AUTH_ENABLED not set → treat all as authenticated
    if (process.env.AUTH_ENABLED !== 'true') {
        req.user = { userId: 'local', plan: 'enterprise', email: 'local@aura-v2' };
        return next();
    }

    try {
        const authHeader = req.headers.authorization || '';
        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authorization header missing or malformed' });
        }
        req.user = verifyToken(authHeader.slice(7));
        next();
    } catch (err) {
        return res.status(401).json({ error: `Unauthorized: ${err.message}` });
    }
}

module.exports = { authMiddleware, signToken, verifyToken };
