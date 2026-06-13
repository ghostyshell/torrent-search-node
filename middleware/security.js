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
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many auth requests, please try again later.' },
  });

  const apiLimiter = rateLimit({
    windowMs,
    max: Math.max(config.security.rateLimiting.max, 1000),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' },
    skip: (req) => req.path === '/health' || req.path.startsWith('/health/'),
  });

  return { apiLimiter, authLimiter };
}

module.exports = { securityHeaders, createRateLimiters };
