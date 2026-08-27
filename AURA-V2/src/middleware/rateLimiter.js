'use strict';
/**
 * AURA-V2: Rate Limiter Middleware
 *
 * INACTIVE by default — set AUTH_ENABLED=true in .env to activate.
 * Uses in-memory Map — upgrade to Redis when scaling horizontally.
 *
 * Plan limits:
 *   free:       3 video generations / day, 1 concurrent
 *   pro:        30 video generations / day, 3 concurrent
 *   enterprise: unlimited
 */

const PLAN_LIMITS = {
    free:       { daily: 3,   concurrent: 1 },
    pro:        { daily: 30,  concurrent: 3 },
    enterprise: { daily: Infinity, concurrent: Infinity },
};

// In-memory store: userId → { count, resetAt, active }
const store = new Map();

function getRecord(userId) {
    const now    = Date.now();
    const dayMs  = 24 * 60 * 60 * 1000;
    let rec = store.get(userId);
    if (!rec || rec.resetAt < now) {
        rec = { count: 0, resetAt: now + dayMs, active: 0 };
        store.set(userId, rec);
    }
    return rec;
}

function rateLimiter(req, res, next) {
    // Bypass when auth is off
    if (process.env.AUTH_ENABLED !== 'true') return next();

    const userId = req.user?.userId || 'anonymous';
    const plan   = req.user?.plan   || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const rec    = getRecord(userId);

    if (rec.count >= limits.daily) {
        return res.status(429).json({
            error: `Daily limit of ${limits.daily} generations reached for plan: ${plan}`,
            plan, limit: limits.daily, resetAt: new Date(rec.resetAt).toISOString(),
        });
    }

    if (rec.active >= limits.concurrent) {
        return res.status(429).json({
            error: `Concurrent limit of ${limits.concurrent} active jobs reached for plan: ${plan}`,
            plan, concurrentLimit: limits.concurrent,
        });
    }

    rec.count++;
    rec.active++;

    // Decrement active on response finish
    res.on('finish', () => {
        const current = store.get(userId);
        if (current) current.active = Math.max(0, current.active - 1);
    });

    next();
}

module.exports = { rateLimiter, PLAN_LIMITS };
