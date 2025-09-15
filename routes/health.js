/**
 * Health check endpoints for monitoring and deployment verification
 */

const express = require('express');
const { config } = require('../config/environment');
const logger = require('../middleware/logger');
const {
  asyncHandler,
  createServiceError,
  createTimeoutError,
} = require('../middleware/errorHandler');

const router = express.Router();

/**
 * Basic health check endpoint
 * Returns simple status for load balancers and Vercel health checks
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: config.environment,
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * Detailed health check endpoint
 * Returns comprehensive system status
 */
router.get(
  '/health/detailed',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: config.environment,
      version: getAppVersion(),
      uptime: Math.floor(process.uptime()),
      memory: getMemoryUsage(),
      system: getSystemInfo(),
      services: {},
      responseTime: 0, // Initialize responseTime
    };

    // Check database health
    try {
      health.services.database = await checkDatabaseHealth(req);
    } catch (error) {
      health.services.database = {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
      health.status = 'degraded';
    }

    // Check external services
    health.services.google = await checkGoogleApiHealth();

    // Overall health assessment
    const unhealthyServices = Object.values(health.services).filter(
      (service) => service.status === 'unhealthy'
    );

    if (unhealthyServices.length > 0) {
      health.status =
        unhealthyServices.length === Object.keys(health.services).length
          ? 'unhealthy'
          : 'degraded';
    }

    // Calculate response time at the end
    health.responseTime = Date.now() - startTime;

    // Set appropriate HTTP status
    const statusCode =
      health.status === 'healthy'
        ? 200
        : health.status === 'degraded'
        ? 200
        : 503;

    logger.info('Health check performed', {
      status: health.status,
      responseTime: health.responseTime,
      services: Object.keys(health.services).map((key) => ({
        name: key,
        status: health.services[key].status,
      })),
    });

    res.status(statusCode).json(health);
  })
);

/**
 * Readiness probe endpoint
 * Checks if application is ready to serve traffic
 */
router.get(
  '/health/ready',
  asyncHandler(async (req, res) => {
    const checks = [];

    // Check database connectivity
    try {
      await checkDatabaseHealth(req);
      checks.push({ name: 'database', status: 'ready' });
    } catch (error) {
      checks.push({
        name: 'database',
        status: 'not_ready',
        error: error.message,
      });
    }

    // Check required environment variables
    const envCheck = checkEnvironmentVariables();
    checks.push(envCheck);

    const allReady = checks.every((check) => check.status === 'ready');

    const response = {
      ready: allReady,
      timestamp: new Date().toISOString(),
      checks,
    };

    res.status(allReady ? 200 : 503).json(response);
  })
);

/**
 * Liveness probe endpoint
 * Checks if application is alive and should not be restarted
 */
router.get('/health/live', (req, res) => {
  // Simple liveness check - if we can respond, we're alive
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * Database health check
 */
async function checkDatabaseHealth(req) {
  // This will be injected by the main app
  const cache = req.app.locals.cache;

  if (!cache) {
    throw new Error('Database not initialized');
  }

  const timeout = new Promise((_, reject) => {
    setTimeout(
      () => reject(createTimeoutError('Database health check')),
      config.healthCheck.timeout
    );
  });

  try {
    const healthCheck = cache.healthCheck
      ? cache.healthCheck()
      : Promise.resolve({ status: 'healthy', type: 'unknown' });

    const result = await Promise.race([healthCheck, timeout]);

    return {
      status: 'healthy',
      type: result.type || 'unknown',
      responseTime: result.responseTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    throw createServiceError('Database', error.message);
  }
}

/**
 * Google API health check
 */
async function checkGoogleApiHealth() {
  try {
    // Simple check - verify configuration exists
    if (!config.google.serviceAccountJson) {
      return {
        status: 'unhealthy',
        error: 'Google API credentials not configured',
        timestamp: new Date().toISOString(),
      };
    }

    if (!config.google.customSearchEngineId) {
      return {
        status: 'unhealthy',
        error: 'Google Custom Search Engine ID not configured',
        timestamp: new Date().toISOString(),
      };
    }

    return {
      status: 'healthy',
      configured: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Check environment variables
 */
function checkEnvironmentVariables() {
  const { validateEnvironment } = require('../config/environment');
  const errors = validateEnvironment();

  return {
    name: 'environment',
    status: errors.length === 0 ? 'ready' : 'not_ready',
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Get application version
 */
function getAppVersion() {
  try {
    const packageJson = require('../package.json');
    return packageJson.version || '1.0.0';
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Get memory usage information
 */
function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024), // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
    external: Math.round(usage.external / 1024 / 1024), // MB
  };
}

/**
 * Get system information
 */
function getSystemInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    pid: process.pid,
  };
}

module.exports = router;
