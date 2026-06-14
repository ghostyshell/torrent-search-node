const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { config } = require('../config/environment');

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
      // Trust authenticated addon traffic. ADDON_API_TOKEN, when set, is the
      // shared secret the addon sends in X-Addon-Token. If it matches, skip
      // the limiter — the addon is bounded by its own internal throttles and
      // is not the threat model (the IP-based limiter is). Without this, the
      // addon's pod-to-pod calls all share one IP, which exhausts the bucket
      // fast (the public URL gets fresh IPs per Stremio client, the internal
      // URL does not).
      const expected = process.env.ADDON_API_TOKEN;
      if (expected && req.get('X-Addon-Token') === expected) return true;
      return false;
    },
  });

  return { apiLimiter, authLimiter };
}

module.exports = { securityHeaders, createRateLimiters };
