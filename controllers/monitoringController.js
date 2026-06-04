const fs = require('fs');
const path = require('path');
const { config } = require('../config/environment');
const { runWithJobFileLogging } = require('../services/backgroundJobFileLogger');

// In-memory storage for background task stats
const backgroundTaskStats = {
  storageCleanup: {
    lastRun: null,
    nextRun: null,
    intervalMs: 60 * 60 * 1000, // 1 hour
    results: [],
    status: 'idle',
  },
  streamUrlRefresh: {
    lastRun: null,
    nextRun: null,
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
    results: [],
    status: 'idle',
  },
  descriptionImageCache: {
    lastRun: null,
    nextRun: null,
    intervalMs: 6 * 60 * 60 * 1000, // 6 hours
    results: [],
    status: 'idle',
  },
  searchResultsCache: {
    lastRun: null,
    nextRun: null,
    intervalMs: 6 * 60 * 60 * 1000, // 6 hours — browse + trans + studio filters
    results: [],
    status: 'idle',
  },
  redisCatalogCache: {
    lastRun: null,
    nextRun: null,
    intervalMs: 30 * 60 * 1000, // ~30 min with jitter — pre-populates Stremio addon Redis keys
    results: [],
    status: 'idle',
  },
  searchQueryCache: {
    lastRun: null,
    nextRun: null,
    intervalMs: 2 * 60 * 60 * 1000, // 2 hours — refreshes Redis + covers for recent search queries
    results: [],
    status: 'idle',
  },
  mongoMigration: {
    lastRun: null,
    nextRun: null,           // manual-only job (no schedule)
    intervalMs: 0,
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

    // Only update nextRun for scheduled runs, not manual triggers
    if (!result.manual) {
      task.nextRun = new Date(Date.now() + task.intervalMs).toISOString();
    }

    task.status = result.success ? 'completed' : 'error';
    task.results.unshift({
      timestamp: task.lastRun,
      ...result,
    });
    // Keep only last 10 results
    if (task.results.length > 10) {
      task.results = task.results.slice(0, 10);
    }

    // Reset status to idle after a few seconds (unless it's still running)
    setTimeout(() => {
      if (task.status !== 'running') {
        task.status = 'idle';
      }
    }, 5000);
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
 * Read approximately the last `maxLines` lines of a file WITHOUT loading the
 * whole file into memory.
 *
 * The monitoring dashboard polls several log endpoints every 10s. The previous
 * implementations streamed the entire `all.log` (which grows unbounded — it had
 * reached 20MB+) into a JS array on every request, allocating tens of MB of
 * string objects per call. Under steady polling the garbage collector couldn't
 * keep up and the heap climbed to the 4GB limit → "JavaScript heap out of
 * memory". Reading only a bounded tail keeps memory flat regardless of file size.
 */
const tailLines = async (filePath, maxLines = 200, maxBytes = 1024 * 1024) => {
  let fh;
  try {
    const { size } = await fs.promises.stat(filePath);
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length <= 0) return [];

    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);

    let text = buf.toString('utf8');
    // If we started mid-file, drop the (likely partial) first line.
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }

    const lines = text.split('\n').filter((l) => l.trim());
    return lines.slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
};

/**
 * Read recent log entries from a log file
 */
const readRecentLogs = async (logFile, limit = 100) => {
  const logPath = path.join(config.logging.logDir, logFile);

  if (!fs.existsSync(logPath)) {
    return [];
  }

  // Pull a tail generous enough to contain `limit` JSON lines without buffering
  // the whole file (log lines are typically a few hundred bytes each).
  const rawLines = await tailLines(logPath, limit, Math.max(1024 * 1024, limit * 2048));
  const logs = [];
  for (const line of rawLines) {
    try {
      logs.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }
  return logs.slice(-limit).reverse();
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

/**
 * Get stream URL refresh job logs
 */
const getStreamUrlRefreshLogs = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const includeAppLogs = req.query.includeAppLogs === 'true';

    const logs = backgroundTaskStats.streamUrlRefresh.results.slice(0, limit);

    // Optionally include recent application logs related to stream refresh
    let recentAppLogs = [];
    if (includeAppLogs) {
      try {
        const logFilePath = path.join(config.logging.logDir, 'all.log');

        if (fs.existsSync(logFilePath)) {
          // Read only the last 200 lines (bounded tail) to avoid buffering the
          // entire all.log into memory on every dashboard poll.
          const streamRefreshLines = (await tailLines(logFilePath, 200))
            .filter(line => line.includes('[Stream Refresh]'));

          // Parse logs and extract relevant information
          recentAppLogs = streamRefreshLines.slice(-50).reverse().map(line => {
            try {
              const parsed = JSON.parse(line);
              return {
                timestamp: parsed.timestamp,
                level: parsed.level,
                message: parsed.message,
                ...parsed
              };
            } catch {
              // Try to extract info from plain text log
              const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
              const levelMatch = line.match(/\b(info|warn|error|debug)\b/i);
              const messageMatch = line.match(/\[Stream Refresh\](.*)/);

              return {
                timestamp: timestampMatch ? timestampMatch[1] : new Date().toISOString(),
                level: levelMatch ? levelMatch[1].toLowerCase() : 'info',
                message: messageMatch ? '[Stream Refresh]' + messageMatch[1] : line,
                raw: line
              };
            }
          });

          console.log(`📋 Found ${recentAppLogs.length} stream refresh log entries`);
        } else {
          console.warn('⚠️ Log file not found:', logFilePath);
        }
      } catch (logError) {
        console.error('❌ Failed to read app logs:', logError.message);
      }
    }

    res.json({
      success: true,
      logs,
      recentAppLogs,
      count: logs.length,
      appLogsCount: recentAppLogs.length,
      status: backgroundTaskStats.streamUrlRefresh.status,
      lastRun: backgroundTaskStats.streamUrlRefresh.lastRun,
      nextRun: backgroundTaskStats.streamUrlRefresh.nextRun,
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
 * Manually trigger stream URL refresh job
 */
const triggerStreamUrlRefresh = async (req, res) => {
  try {
    const storageProvider = req.app.locals.storageProvider;

    if (!storageProvider) {
      return res.status(503).json({
        success: false,
        error: 'Storage provider not available',
      });
    }

    // Set status to running
    backgroundTaskStats.streamUrlRefresh.status = 'running';

    res.json({
      success: true,
      message: 'Stream URL refresh job started',
      status: 'running',
    });

    // Run the refresh in the background
    const StreamUrlRefreshService = require('../services/streamUrlRefreshService');
    const AuthService = require('../config/passport');
    const logger = require('../middleware/logger');

    const authService = new AuthService(storageProvider);
    const refreshService = new StreamUrlRefreshService(storageProvider, authService);

    // Execute asynchronously
    (async () => {
      await runWithJobFileLogging('streamUrlRefresh', async () => {
        try {
          logger.info('Manual stream URL refresh triggered');
          const result = await refreshService.refreshAllFavoriteStreamUrls();
          logger.info('Manual stream URL refresh completed', {
            totalFavorites: result.totalFavorites,
            usersProcessed: result.usersProcessed,
            refreshed: result.refreshed,
            retriedSuccesses: result.retriedSuccesses,
            skipped: result.skipped,
            failed: result.failed,
          });

          if (result.errors.length > 0) {
            logger.warn('Stream URL refresh had errors', { errors: result.errors.slice(0, 5) });
          }

          updateTaskStats('streamUrlRefresh', {
            success: true,
            manual: true,
            totalFavorites: result.totalFavorites,
            usersProcessed: result.usersProcessed,
            refreshed: result.refreshed,
            retriedSuccesses: result.retriedSuccesses,
            skipped: result.skipped,
            failed: result.failed,
          });
        } catch (error) {
          logger.error('Error during manual stream URL refresh', { error: error.message });
          updateTaskStats('streamUrlRefresh', {
            success: false,
            manual: true,
            error: error.message
          });
        }
      });
    })();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get description/image cache job logs
 */
const getDescriptionImageCacheLogs = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const includeAppLogs = req.query.includeAppLogs === 'true';

    const logs = backgroundTaskStats.descriptionImageCache.results.slice(0, limit);

    let recentAppLogs = [];
    if (includeAppLogs) {
      try {
        const logFilePath = path.join(config.logging.logDir, 'all.log');

        if (fs.existsSync(logFilePath)) {
          const filteredLines = (await tailLines(logFilePath, 200))
            .filter(line => line.includes('[DescImageCache]'));

          recentAppLogs = filteredLines.slice(-50).reverse().map(line => {
            try {
              const parsed = JSON.parse(line);
              return {
                timestamp: parsed.timestamp,
                level: parsed.level,
                message: parsed.message,
                ...parsed
              };
            } catch {
              const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
              const levelMatch = line.match(/\b(info|warn|error|debug)\b/i);
              const messageMatch = line.match(/\[DescImageCache\](.*)/);

              return {
                timestamp: timestampMatch ? timestampMatch[1] : new Date().toISOString(),
                level: levelMatch ? levelMatch[1].toLowerCase() : 'info',
                message: messageMatch ? '[DescImageCache]' + messageMatch[1] : line,
                raw: line
              };
            }
          });
        }
      } catch (logError) {
        console.error('❌ Failed to read app logs:', logError.message);
      }
    }

    res.json({
      success: true,
      logs,
      recentAppLogs,
      count: logs.length,
      appLogsCount: recentAppLogs.length,
      status: backgroundTaskStats.descriptionImageCache.status,
      lastRun: backgroundTaskStats.descriptionImageCache.lastRun,
      nextRun: backgroundTaskStats.descriptionImageCache.nextRun,
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
 * Manually trigger description/image cache job
 */
const triggerDescriptionImageCache = async (req, res) => {
  try {
    const storageProvider = req.app.locals.storageProvider;

    if (!storageProvider) {
      return res.status(503).json({
        success: false,
        error: 'Storage provider not available',
      });
    }

    // Set status to running
    backgroundTaskStats.descriptionImageCache.status = 'running';

    res.json({
      success: true,
      message: 'Description/image cache job started',
      status: 'running',
    });

    // Run the job in the background
    const DescriptionImageCacheService = require('../services/descriptionImageCacheService');
    const logger = require('../middleware/logger');

    const cacheService = new DescriptionImageCacheService(storageProvider);

    (async () => {
      await runWithJobFileLogging('descriptionImageCache', async () => {
        try {
          logger.info('Manual description/image cache job triggered');
          const result = await cacheService.runCacheJob();
          logger.info('Manual description/image cache job completed', {
            totalSearches: result.totalSearches,
            totalTorrents: result.totalTorrents,
            imagesFound: result.imagesFound,
            cached: result.cached,
            replaced: result.replaced,
            skipped: result.skipped,
            failed: result.failed,
          });

          if (result.errors.length > 0) {
            logger.warn('Description/image cache job had errors', { errors: result.errors.slice(0, 5) });
          }

          updateTaskStats('descriptionImageCache', {
            success: true,
            manual: true,
            totalSearches: result.totalSearches,
            totalTorrents: result.totalTorrents,
            imagesFound: result.imagesFound,
            cached: result.cached,
            replaced: result.replaced,
            skipped: result.skipped,
            failed: result.failed,
          });
        } catch (error) {
          logger.error('Error during manual description/image cache job', { error: error.message });
          updateTaskStats('descriptionImageCache', {
            success: false,
            manual: true,
            error: error.message
          });
        }
      });
    })();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Manually trigger description/image cache job with force refresh (replaces existing covers)
 */
const triggerDescriptionImageCacheForceRefresh = async (req, res) => {
  try {
    const storageProvider = req.app.locals.storageProvider;

    if (!storageProvider) {
      return res.status(503).json({
        success: false,
        error: 'Storage provider not available',
      });
    }

    backgroundTaskStats.descriptionImageCache.status = 'running';

    res.json({
      success: true,
      message: 'Description/image cache job started (force refresh)',
      status: 'running',
    });

    const DescriptionImageCacheService = require('../services/descriptionImageCacheService');
    const logger = require('../middleware/logger');

    const cacheService = new DescriptionImageCacheService(storageProvider);

    (async () => {
      await runWithJobFileLogging('descriptionImageCache', async () => {
        try {
          logger.info('Manual description/image cache job triggered (FORCE REFRESH)');
          const result = await cacheService.runCacheJob({ forceRefresh: true });
          logger.info('Manual description/image cache job completed (force refresh)', {
            totalSearches: result.totalSearches,
            totalTorrents: result.totalTorrents,
            imagesFound: result.imagesFound,
            cached: result.cached,
            replaced: result.replaced,
            skipped: result.skipped,
            failed: result.failed,
          });

          if (result.errors.length > 0) {
            logger.warn('Description/image cache job had errors', { errors: result.errors.slice(0, 5) });
          }

          updateTaskStats('descriptionImageCache', {
            success: true,
            manual: true,
            forceRefresh: true,
            totalSearches: result.totalSearches,
            totalTorrents: result.totalTorrents,
            imagesFound: result.imagesFound,
            cached: result.cached,
            replaced: result.replaced,
            skipped: result.skipped,
            failed: result.failed,
          });
        } catch (error) {
          logger.error('Error during manual description/image cache job (force refresh)', { error: error.message });
          updateTaskStats('descriptionImageCache', {
            success: false,
            manual: true,
            forceRefresh: true,
            error: error.message,
          });
        }
      });
    })();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get search results cache job logs
 */
const getSearchResultsCacheLogs = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const logs = backgroundTaskStats.searchResultsCache.results.slice(0, limit);

    res.json({
      success: true,
      logs,
      count: logs.length,
      status: backgroundTaskStats.searchResultsCache.status,
      lastRun: backgroundTaskStats.searchResultsCache.lastRun,
      nextRun: backgroundTaskStats.searchResultsCache.nextRun,
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
 * Manually trigger search results cache job
 */
const triggerSearchResultsCache = async (req, res) => {
  try {
    const storageProvider = req.app.locals.storageProvider;

    if (!storageProvider) {
      return res.status(503).json({
        success: false,
        error: 'Storage provider not available',
      });
    }

    backgroundTaskStats.searchResultsCache.status = 'running';

    res.json({
      success: true,
      message: 'Search results cache job started',
      status: 'running',
    });

    // Run the job in the background
    (async () => {
      await runWithJobFileLogging('searchResultsCache', async () => {
        try {
          const FilterStreamCacheService = require('../services/searchResultsCacheService');
          const StreamUrlRefreshService = require('../services/streamUrlRefreshService');
          const AuthService = require('../config/passport');
          const logger = require('../middleware/logger');

          const authService = new AuthService(storageProvider);
          const refreshService = new StreamUrlRefreshService(storageProvider, authService);
          const cacheService = new FilterStreamCacheService(storageProvider, refreshService, authService);

          logger.info('Running manually triggered filter stream cache job');
          const result = await cacheService.runCacheJob();

          logger.info('Manual filter stream cache job completed', {
            totalSearches: result.totalSearches,
            totalTorrents: result.totalTorrents,
            uniqueMagnets: result.uniqueMagnets,
            usersProcessed: result.usersProcessed,
            alreadyCached: result.alreadyCached,
            refreshed: result.refreshed,
            failed: result.failed,
          });

          updateTaskStats('searchResultsCache', {
            success: true,
            manual: true,
            totalSearches: result.totalSearches,
            totalTorrents: result.totalTorrents,
            uniqueMagnets: result.uniqueMagnets,
            usersProcessed: result.usersProcessed,
            usersSkipped: result.usersSkipped,
            alreadyCached: result.alreadyCached,
            refreshed: result.refreshed,
            noMagnet: result.noMagnet,
            failed: result.failed,
          });
        } catch (error) {
          const logger = require('../middleware/logger');
          logger.error('Error during manual filter stream cache job', { error: error.message });
          updateTaskStats('searchResultsCache', {
            success: false,
            manual: true,
            error: error.message,
          });
        }
      });
    })();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get Redis catalog cache job logs
 */
const getRedisCatalogCacheLogs = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const includeAppLogs = req.query.includeAppLogs === 'true';

    const logs = backgroundTaskStats.redisCatalogCache.results.slice(0, limit);

    let recentAppLogs = [];
    if (includeAppLogs) {
      try {
        const logFilePath = path.join(config.logging.logDir, 'all.log');
        if (fs.existsSync(logFilePath)) {
          const filteredLines = (await tailLines(logFilePath, 200)).filter(line => line.includes('[redisCatalog]'));
          recentAppLogs = filteredLines.slice(-50).reverse().map(line => {
            try {
              const parsed = JSON.parse(line);
              return { timestamp: parsed.timestamp, level: parsed.level, message: parsed.message, ...parsed };
            } catch {
              const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
              const levelMatch = line.match(/\b(info|warn|error|debug)\b/i);
              const messageMatch = line.match(/\[redisCatalog\](.*)/);
              return {
                timestamp: timestampMatch ? timestampMatch[1] : new Date().toISOString(),
                level: levelMatch ? levelMatch[1].toLowerCase() : 'info',
                message: messageMatch ? '[redisCatalog]' + messageMatch[1] : line,
                raw: line,
              };
            }
          });
        }
      } catch (logError) {
        console.error('Failed to read app logs for redisCatalog:', logError.message);
      }
    }

    res.json({
      success: true,
      logs,
      recentAppLogs,
      count: logs.length,
      appLogsCount: recentAppLogs.length,
      status: backgroundTaskStats.redisCatalogCache.status,
      lastRun: backgroundTaskStats.redisCatalogCache.lastRun,
      nextRun: backgroundTaskStats.redisCatalogCache.nextRun,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Manually trigger Redis catalog cache job
 */
const triggerRedisCatalogCache = async (req, res) => {
  try {
    if (!process.env.REDIS_URL) {
      return res.status(503).json({ success: false, error: 'REDIS_URL not configured' });
    }
    if (!process.env.BASE_URL) {
      return res.status(503).json({ success: false, error: 'BASE_URL not configured' });
    }

    backgroundTaskStats.redisCatalogCache.status = 'running';

    res.json({ success: true, message: 'Redis catalog cache job started', status: 'running' });

    const RedisCatalogCacheService = require('../services/redisCatalogCacheService');
    const logger = require('../middleware/logger');
    const cacheService = new RedisCatalogCacheService();

    (async () => {
      await runWithJobFileLogging('redisCatalogCache', async () => {
        try {
          logger.info('[redisCatalog] Manual cache job triggered');
          const result = await cacheService.runJob();
          logger.info('[redisCatalog] Manual cache job completed', result);
          updateTaskStats('redisCatalogCache', { success: true, manual: true, ...result });
        } catch (error) {
          logger.error('[redisCatalog] Manual job error', { error: error.message });
          updateTaskStats('redisCatalogCache', { success: false, manual: true, error: error.message });
        }
      });
    })();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/monitoring/cover-storage-maintenance-trigger
 * Manually triggers the cover storage maintenance job (refresh presigned URLs + cleanup expired temp).
 * Idempotent — safe to call even while scheduled maintenance is running.
 */
const triggerCoverStorageMaintenance = async (req, res) => {
  const storageProvider = req.app.locals.storageProvider;
  if (!storageProvider) {
    return res.status(503).json({ success: false, error: 'Storage provider not available' });
  }

  const objectStorage = require('../services/objectStorageService');
  if (!objectStorage.isEnabled()) {
    return res.status(503).json({ success: false, error: 'Object storage not configured' });
  }

  const maint = require('../services/coverStorageMaintenanceService');
  const logger = require('../middleware/logger');

  try {
    const refreshResult = await maint.refreshPresignedUrls(storageProvider, logger);
    const cleanupResult = await maint.cleanupExpiredTemp(storageProvider, logger);
    res.json({
      success: true,
      refresh: refreshResult,
      cleanup: cleanupResult,
    });
  } catch (e) {
    logger.error('Manual cover storage maintenance failed', { error: e.message });
    res.status(500).json({ success: false, error: e.message });
  }
};

const getSearchQueryCacheLogs = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const logs  = backgroundTaskStats.searchQueryCache.results.slice(0, limit);
  res.json({
    status:  backgroundTaskStats.searchQueryCache.status,
    lastRun: backgroundTaskStats.searchQueryCache.lastRun,
    nextRun: backgroundTaskStats.searchQueryCache.nextRun,
    logs,
  });
};

const triggerSearchQueryCache = async (req, res) => {
  const storageProvider = req.app.locals.storageProvider;
  if (!storageProvider) {
    return res.status(503).json({ success: false, error: 'Storage provider not available' });
  }

  const SearchQueryCacheService = require('../services/searchQueryCacheService');
  const cacheService = new SearchQueryCacheService(storageProvider);

  try {
    backgroundTaskStats.searchQueryCache.status = 'running';
    await runWithJobFileLogging('searchQueryCache', async () => {
      try {
        const result = await cacheService.runJob();
        updateTaskStats('searchQueryCache', { success: true, manual: true, ...result });
        res.json({ success: true, manual: true, result });
      } catch (error) {
        updateTaskStats('searchQueryCache', { success: false, manual: true, error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
  } catch (error) {
    backgroundTaskStats.searchQueryCache.status = 'idle';
    res.status(500).json({ success: false, error: error.message });
  }
};

// ── MongoDB migration (manual one-shot Turso → Mongo data copy) ───────────────

const getMongoMigrationLogs = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const task = backgroundTaskStats.mongoMigration;
  res.json({
    success: true,
    status:  task.status,
    lastRun: task.lastRun,
    logs:    task.results.slice(0, limit),
    mongoConfigured: !!(req.app.locals.mongoClient && req.app.locals.mongoClient.isConfigured()),
    mongoConnected:  !!(req.app.locals.mongoClient && req.app.locals.mongoClient.isConnected),
  });
};

const triggerMongoMigration = async (req, res) => {
  const storageProvider = req.app.locals.storageProvider;
  const mongoClient = req.app.locals.mongoClient;

  if (!storageProvider) {
    return res.status(503).json({ success: false, error: 'Storage provider not available' });
  }
  if (!mongoClient || !mongoClient.isConnected) {
    return res.status(503).json({ success: false, error: 'MongoDB not connected — set MONGODB_URI and restart the server' });
  }
  if (backgroundTaskStats.mongoMigration.status === 'running') {
    return res.status(409).json({ success: false, error: 'Migration already running' });
  }

  const MongoMigrationService = require('../services/mongoMigrationService');
  const migrationService = new MongoMigrationService(storageProvider, mongoClient);

  try {
    backgroundTaskStats.mongoMigration.status = 'running';
    await runWithJobFileLogging('mongoMigration', async () => {
      try {
        const result = await migrationService.runJob();
        updateTaskStats('mongoMigration', { success: true, manual: true, ...result });
        res.json({ success: true, manual: true, result });
      } catch (error) {
        updateTaskStats('mongoMigration', { success: false, manual: true, error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
  } catch (error) {
    backgroundTaskStats.mongoMigration.status = 'idle';
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getLogs,
  getBackgroundTaskStats,
  getApiUsageStats,
  getDashboardData,
  getStreamUrlRefreshLogs,
  triggerStreamUrlRefresh,
  getDescriptionImageCacheLogs,
  triggerDescriptionImageCache,
  triggerDescriptionImageCacheForceRefresh,
  getSearchResultsCacheLogs,
  triggerSearchResultsCache,
  apiTrackingMiddleware,
  updateTaskStats,
  backgroundTaskStats,
  triggerCoverStorageMaintenance,
  getRedisCatalogCacheLogs,
  triggerRedisCatalogCache,
  getSearchQueryCacheLogs,
  triggerSearchQueryCache,
  getMongoMigrationLogs,
  triggerMongoMigration,
};
