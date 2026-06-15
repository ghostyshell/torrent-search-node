const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { config } = require('../config/environment');

function matchesAddonToken(req) {
  const expected = process.env.ADDON_API_TOKEN;
  if (!expected) return false;
  const authHeader = req.get('Authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';
  return bearerToken === expected || req.get('X-Addon-Token') === expected;
}

/**
 * Security headers. CSP disabled so the monitoring dashboard inline scripts keep working.
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * Rate limiters — only active when config.security.rateLimiting.enabled (production).
 */
function createRateLimiters() {
  if (!config.security.rateLimiting.enabled) {
    return { apiLimiter: null, authLimiter: null };
  }

  const { windowMs } = config.security.rateLimiting;

  const authLimiter = rateLimit({
    windowMs,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many auth requests, please try again later.' },
  });

  const apiLimiter = rateLimit({
    windowMs,
    max: Math.max(config.security.rateLimiting.max, 3000),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' },
    skip: (req) => {
      if (req.path === '/health' || req.path.startsWith('/health/')) return true;
      // Trust authenticated addon traffic (Bearer or X-Addon-Token). Without
      // this, the addon's pod-to-pod calls all share one IP and exhaust the
      // rate-limit bucket quickly.
      if (matchesAddonToken(req)) return true;
      return false;
    },
  });

  return { apiLimiter, authLimiter };
}

module.exports = { securityHeaders, createRateLimiters };
