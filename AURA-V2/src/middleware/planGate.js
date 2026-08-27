'use strict';
/**
 * AURA-V2: Plan Gate Middleware
 *
 * INACTIVE by default — set AUTH_ENABLED=true to activate.
 * Use requirePlan('pro') to protect routes from free-tier users.
 *
 * Usage:
 *   const { requirePlan } = require('../middleware/planGate');
 *   router.post('/batch-generate', requirePlan('pro'), handler);
 */

const PLAN_HIERARCHY = { free: 0, pro: 1, enterprise: 2 };

function requirePlan(minimumPlan) {
    return (req, res, next) => {
        // Bypass when auth is off
        if (process.env.AUTH_ENABLED !== 'true') return next();

        const userPlan = req.user?.plan || 'free';
        const userTier = PLAN_HIERARCHY[userPlan] ?? 0;
        const reqTier  = PLAN_HIERARCHY[minimumPlan] ?? 1;

        if (userTier < reqTier) {
            return res.status(403).json({
                error:    `This feature requires the '${minimumPlan}' plan or above.`,
                yourPlan: userPlan,
                required: minimumPlan,
            });
        }
        next();
    };
}

module.exports = { requirePlan };
