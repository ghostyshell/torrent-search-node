/**
 * Enhanced CORS middleware with environment-specific configuration
 */

const { config } = require('../config/environment');
const logger = require('./logger');

/**
 * Dynamic CORS middleware that adapts to environment
 */
function corsMiddleware() {
  return (req, res, next) => {
    const origin = req.get('Origin');
    const corsConfig = config.cors;

    // Determine if origin is allowed
    let allowedOrigin = null;

    if (corsConfig.origins.includes('*')) {
      // Wildcard - allow all origins (not recommended for production)
      allowedOrigin = origin || '*';
      logger.warn('CORS: Wildcard origin allowed', {
        requestOrigin: origin,
        environment: config.environment,
      });
    } else {
      // Check if origin is in allowed list
      if (origin && corsConfig.origins.includes(origin)) {
        allowedOrigin = origin;
      } else if (!origin) {
        // Allow requests without origin (e.g., mobile apps, Postman)
        allowedOrigin = corsConfig.origins[0] || '*';
      }
    }

    // Set CORS headers
    if (allowedOrigin) {
      res.header('Access-Control-Allow-Origin', allowedOrigin);
    }

    res.header('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
    res.header(
      'Access-Control-Allow-Headers',
      corsConfig.allowedHeaders.join(', ')
    );
    res.header(
      'Access-Control-Expose-Headers',
      corsConfig.exposedHeaders.join(', ')
    );

    if (corsConfig.credentials) {
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    // Log CORS decisions in development
    if (config.isDevelopment) {
      logger.debug('CORS headers set', {
        requestOrigin: origin,
        allowedOrigin,
        method: req.method,
        url: req.url,
      });
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      logger.debug('CORS preflight request handled', {
        origin,
        allowedOrigin,
        url: req.url,
      });
      return res.status(200).end();
    }

    // Log blocked requests
    if (origin && !allowedOrigin) {
      logger.warn('CORS: Origin blocked', {
        blockedOrigin: origin,
        allowedOrigins: corsConfig.origins,
        url: req.url,
        method: req.method,
      });
    }

    next();
  };
}

/**
 * Validate CORS configuration
 */
function validateCorsConfig() {
  const errors = [];

  if (!config.cors.origins || config.cors.origins.length === 0) {
    errors.push('CORS origins not configured');
  }

  if (config.isProduction && config.cors.origins.includes('*')) {
    errors.push('Wildcard CORS origin not recommended for production');
  }

  return errors;
}

module.exports = {
  corsMiddleware,
  validateCorsConfig,
};
