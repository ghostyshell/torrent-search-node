/**
 * Environment Configuration Module
 * Handles environment-specific settings for development and production modes
 */

const path = require('path');

// Load environment variables
require('dotenv').config();

const isDevelopment = process.env.NODE_ENV !== 'production';
const isProduction = process.env.NODE_ENV === 'production';

const config = {
  // Environment settings
  environment: process.env.NODE_ENV || 'development',
  isDevelopment,
  isProduction,

  // Server configuration
  server: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || '0.0.0.0',
  },

  // CORS configuration - environment specific
  cors: {
    origins: getCorsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'Range',
    ],
    exposedHeaders: [
      'Content-Range',
      'Accept-Ranges',
      'Content-Length',
      'Content-Type',
    ],
  },

  // Database configuration - Turso cloud (primary) + optional MongoDB experiment
  database: {
    turso: {
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    },
    mongo: {
      // Connection string for the Sliplane MongoDB instance. Accepts either
      // MONGODB_URI or MONGO_URL — a full connection string (credentials may be
      // embedded). If the URL has no credentials and MONGO_USERNAME/MONGO_PASSWORD
      // are provided separately, they're injected (URL-encoded). When unset,
      // Mongo features are disabled.
      uri: buildMongoUri(),
      dbName: process.env.MONGODB_DB || 'torrent_search',
      // Experiment flag: when true (and a uri is set) reads come from MongoDB and
      // writes are mirrored to BOTH MongoDB and Turso (Turso stays a hot standby
      // for instant rollback). When false, everything uses Turso unchanged.
      experiment:
        (process.env.EXPERIMENT_MONGODB || '').toLowerCase() === 'true' &&
        !!buildMongoUri(),
    },
  },

  // Google API configuration
  google: {
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    customSearchEngineId: process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID,
  },

  // External API keys
  apiKeys: {
    realDebrid: process.env.REAL_DEBRID_API_KEY,
  },

  // Logging configuration
  logging: {
    level: isProduction ? 'info' : 'debug',
    enableConsole: false,
    enableFile: true,
    logDir: path.join(__dirname, '..', 'logs'),
    /** Subfolder layout: background-jobs/{version}/{jobName}/{YYYY-MM-DD}/{runId}.log */
    backgroundJobsLogVersion: process.env.BACKGROUND_JOBS_LOG_VERSION || 'v1',
    backgroundJobLogRetentionDays: Math.max(
      1,
      parseInt(process.env.BACKGROUND_JOB_LOG_RETENTION_DAYS || '30', 10) || 30
    ),
    /** Only gzip .log files idle at least this long (avoids compressing an active run) */
    backgroundJobLogCompressAfterMs: Math.max(
      60 * 1000,
      parseInt(
        process.env.BACKGROUND_JOB_LOG_COMPRESS_AFTER_MS || String(6 * 60 * 60 * 1000),
        10
      ) || 6 * 60 * 60 * 1000
    ),
    backgroundJobLogMaintenanceIntervalMs: Math.max(
      60 * 60 * 1000,
      parseInt(
        process.env.BACKGROUND_JOB_LOG_MAINTENANCE_INTERVAL_MS || String(24 * 60 * 60 * 1000),
        10
      ) || 24 * 60 * 60 * 1000
    ),
    backgroundJobLogMaintenanceInitialDelayMs: Math.max(
      5 * 60 * 1000,
      parseInt(process.env.BACKGROUND_JOB_LOG_MAINTENANCE_INITIAL_DELAY_MS || String(15 * 60 * 1000), 10) ||
        15 * 60 * 1000
    ),
  },

  // Health check configuration
  healthCheck: {
    timeout: 5000, // 5 seconds
    retries: 3,
  },

  // Security settings
  security: {
    trustProxy: isProduction,
    rateLimiting: {
      enabled: isProduction,
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: isProduction ? 100 : 1000, // requests per window
    },
    // IP allowlist for monitoring/debug endpoints
    monitoringIpAllowlist: getMonitoringIpAllowlist(),
    // Password gating the monitoring dashboard endpoints (sent via the
    // X-Dashboard-Password header or dashboard_auth cookie). When unset the
    // dashboard is not password-protected (relies on the IP allowlist).
    dashboardPassword: process.env.DASHBOARD_PASSWORD || null,
  },

  // Cache TTLs
  cache: {
    // How long a cached Real-Debrid stream URL is considered fresh.
    // Read path treats anything older than this as a miss so the frontend
    // regenerates instead of handing the player a stale token. The favorites
    // refresh job runs every 24h, so default this to 20h to leave a 4h buffer.
    streamUrlTtlSeconds: Math.max(
      60,
      parseInt(process.env.STREAM_URL_TTL_SECONDS || String(20 * 60 * 60), 10) ||
        20 * 60 * 60
    ),
  },

  // Railway-specific configuration
  railway: {
    isRailway: !!process.env.RAILWAY_ENVIRONMENT,
    environment: process.env.RAILWAY_ENVIRONMENT,
    staticUrl: process.env.RAILWAY_STATIC_URL,
    publicDomain: process.env.RAILWAY_PUBLIC_DOMAIN,
  },
};

/**
 * Get IP allowlist for monitoring/debug endpoints
 */
/**
 * Build the MongoDB connection URI.
 * Base comes from MONGODB_URI or MONGO_URL. If that URL carries no credentials
 * and MONGO_USERNAME/MONGO_PASSWORD (or MONGO_USER/MONGO_PASS) are set, inject
 * them URL-encoded. Returns '' when no base URL is configured.
 */
function buildMongoUri() {
  const base = process.env.MONGODB_URI || process.env.MONGO_URL || '';
  if (!base) return '';

  const user = process.env.MONGO_USERNAME || process.env.MONGO_USER || '';
  const pass = process.env.MONGO_PASSWORD || process.env.MONGO_PASS || '';
  if (!user || !pass) return base;

  // Only inject into a standard mongodb:// or mongodb+srv:// URL that doesn't
  // already include "user:pass@". Otherwise return the base untouched.
  const m = base.match(/^(mongodb(?:\+srv)?:\/\/)([^/].*)$/i);
  if (!m || m[2].includes('@')) return base;

  return `${m[1]}${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${m[2]}`;
}

function getMonitoringIpAllowlist() {
  const allowlistStr = process.env.MONITORING_IP_ALLOWLIST || '';
  if (!allowlistStr.trim()) {
    return []; // Empty = no IP restrictions (relies on auth only)
  }
  return allowlistStr
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
}

/**
 * Get CORS origins based on environment
 */
function getCorsOrigins() {
  if (isDevelopment) {
    // Development: Allow localhost and common development URLs
    return [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      process.env.FRONTEND_URL,
    ].filter(Boolean);
  } else {
    // Production: Use specific frontend URL(s)
    const origins = [];

    if (process.env.FRONTEND_URL) {
      origins.push(process.env.FRONTEND_URL);
    }

    // Add additional production domains if specified
    if (process.env.ADDITIONAL_CORS_ORIGINS) {
      const additionalOrigins = process.env.ADDITIONAL_CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
      origins.push(...additionalOrigins);
    }

    // Fallback to wildcard if no origins specified (not recommended for production)
    return origins.length > 0 ? origins : ['*'];
  }
}

/**
 * Validate required environment variables
 */
function validateEnvironment() {
  const errors = [];

  // Check database configuration
  if (!config.database.turso.url) {
    errors.push('TURSO_DATABASE_URL is required');
  }
  if (!config.database.turso.authToken) {
    errors.push('TURSO_AUTH_TOKEN is required');
  }

  // Check Google API configuration
  if (!config.google.serviceAccountJson) {
    errors.push('GOOGLE_SERVICE_ACCOUNT_JSON is required');
  }

  if (!config.google.customSearchEngineId) {
    errors.push('GOOGLE_CUSTOM_SEARCH_ENGINE_ID is required');
  }

  // Production-specific validations
  if (isProduction) {
    if (!process.env.FRONTEND_URL) {
      errors.push('FRONTEND_URL is required in production');
    }

    // Railway-specific validations
    if (process.env.RAILWAY_ENVIRONMENT) {
      // Running on Railway
      if (!process.env.PORT) {
        errors.push('PORT should be set by Railway automatically');
      }
    }
  }

  return errors;
}

/**
 * Validate CORS configuration
 */
function validateCorsConfig() {
  const errors = [];

  if (config.cors.origins.includes('*') && isProduction) {
    errors.push('CORS wildcard (*) is not recommended for production');
  }

  return errors;
}

/**
 * Get configuration for specific component
 */
function getConfig(component) {
  if (component && config[component]) {
    return config[component];
  }
  return config;
}

module.exports = {
  config,
  getConfig,
  validateEnvironment,
  isDevelopment,
  isProduction,
};
