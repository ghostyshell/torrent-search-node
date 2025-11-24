const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('../config/environment');

// In-memory storage for background task stats
const backgroundTaskStats = {
  storageCleanup: {
    lastRun: null,
    nextRun: null,
    intervalMs: 60 * 60 * 1000, // 1 hour
    results: [],
    status: 'idle',
  },
  tokenRefresh: {
    lastRun: null,
    nextRun: null,
    intervalMs: 45 * 60 * 1000, // 45 minutes
    results: [],
    status: 'disabled',
  },
  streamUrlRefresh: {
    lastRun: null,
    nextRun: null,
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
    results: [],
    status: 'idle',
  },
};

// In-memory API usage tracking
const apiUsageStats = {
  totalRequests: 0,
  requestsByEndpoint: {},
  requestsByMethod: {},
  requestsByStatus: {},
  recentRequests: [],
  startTime: Date.now(),
};

/**
 * Update background task stats
 */
const updateTaskStats = (taskName, result) => {
  if (backgroundTaskStats[taskName]) {
    const task = backgroundTaskStats[taskName];
    task.lastRun = new Date().toISOString();
    task.nextRun = new Date(Date.now() + task.intervalMs).toISOString();
    task.status = 'completed';
    task.results.unshift({
      timestamp: task.lastRun,
      ...result,
    });
    // Keep only last 10 results
    if (task.results.length > 10) {
      task.results = task.results.slice(0, 10);
    }
  }
};

/**
 * Track API request
 */
const trackApiRequest = (req, res, duration) => {
  apiUsageStats.totalRequests++;

  // Track by endpoint (normalize path)
  const endpoint = req.route?.path || req.path || req.url.split('?')[0];
  apiUsageStats.requestsByEndpoint[endpoint] = (apiUsageStats.requestsByEndpoint[endpoint] || 0) + 1;

  // Track by method
  apiUsageStats.requestsByMethod[req.method] = (apiUsageStats.requestsByMethod[req.method] || 0) + 1;

  // Track by status
  const statusGroup = `${Math.floor(res.statusCode / 100)}xx`;
  apiUsageStats.requestsByStatus[statusGroup] = (apiUsageStats.requestsByStatus[statusGroup] || 0) + 1;

  // Store recent request
  apiUsageStats.recentRequests.unshift({
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.url,
    status: res.statusCode,
    duration: duration,
    userAgent: req.get('user-agent')?.substring(0, 100),
  });

  // Keep only last 100 recent requests
  if (apiUsageStats.recentRequests.length > 100) {
    apiUsageStats.recentRequests = apiUsageStats.recentRequests.slice(0, 100);
  }
};

/**
 * Middleware to track API usage
 */
const apiTrackingMiddleware = () => {
  return (req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      trackApiRequest(req, res, duration);
    });

    next();
  };
};

/**
 * Read recent log entries from a log file
 */
const readRecentLogs = async (logFile, limit = 100) => {
  const logPath = path.join(config.logging.logDir, logFile);

  if (!fs.existsSync(logPath)) {
    return [];
  }

  return new Promise((resolve) => {
    const logs = [];
    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      try {
        const parsed = JSON.parse(line);
        logs.push(parsed);
      } catch {
        // Skip malformed lines
      }
    });

    rl.on('close', () => {
      // Return last N entries
      resolve(logs.slice(-limit).reverse());
    });

    rl.on('error', () => {
      resolve([]);
    });
  });
};

/**
 * Get logs endpoint
 */
const getLogs = async (req, res) => {
  try {
    const level = req.query.level || 'all';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);

    const logFile = level === 'all' ? 'all.log' : `${level}.log`;
    const logs = await readRecentLogs(logFile, limit);

    res.json({
      success: true,
      level,
      count: logs.length,
      logs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get background task stats endpoint
 */
const getBackgroundTaskStats = async (req, res) => {
  try {
    res.json({
      success: true,
      tasks: backgroundTaskStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get API usage stats endpoint
 */
const getApiUsageStats = async (req, res) => {
  try {
    const uptime = Date.now() - apiUsageStats.startTime;
    const requestsPerMinute = apiUsageStats.totalRequests / (uptime / 60000);

    // Get top endpoints
    const topEndpoints = Object.entries(apiUsageStats.requestsByEndpoint)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([endpoint, count]) => ({ endpoint, count }));

    res.json({
      success: true,
      stats: {
        totalRequests: apiUsageStats.totalRequests,
        requestsPerMinute: Math.round(requestsPerMinute * 100) / 100,
        uptime: Math.round(uptime / 1000),
        byMethod: apiUsageStats.requestsByMethod,
        byStatus: apiUsageStats.requestsByStatus,
        topEndpoints,
      },
      recentRequests: apiUsageStats.recentRequests.slice(0, 50),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get combined monitoring dashboard data
 */
const getDashboardData = async (req, res) => {
  try {
    const storageProvider = req.app.locals.storageProvider;
    let dbStats = null;

    if (storageProvider) {
      dbStats = await storageProvider.getStats();
    }

    const uptime = Date.now() - apiUsageStats.startTime;
    const memoryUsage = process.memoryUsage();

    res.json({
      success: true,
      system: {
        uptime: Math.round(uptime / 1000),
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        },
        nodeVersion: process.version,
        environment: config.nodeEnv,
      },
      database: dbStats,
      api: {
        totalRequests: apiUsageStats.totalRequests,
        requestsPerMinute: Math.round((apiUsageStats.totalRequests / (uptime / 60000)) * 100) / 100,
        byMethod: apiUsageStats.requestsByMethod,
        byStatus: apiUsageStats.requestsByStatus,
      },
      backgroundTasks: Object.entries(backgroundTaskStats).map(([name, task]) => ({
        name,
        status: task.status,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
        lastResult: task.results[0] || null,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  getLogs,
  getBackgroundTaskStats,
  getApiUsageStats,
  getDashboardData,
  apiTrackingMiddleware,
  updateTaskStats,
  backgroundTaskStats,
};
