const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { config } = require('../config/environment');
const { runWithJobFileLogging } = require('../services/backgroundJobFileLogger');

// In-memory storage for background task stats
const imageHostMigrationState = {
  status: 'idle', // idle | running | completed | error
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  startedAt: null,
  completedAt: null,
  lastError: null,
};

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
          // Read the last 1000 lines of the file for performance
          const fileStream = fs.createReadStream(logFilePath);
          const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
          });

          const allLines = [];
          for await (const line of rl) {
            if (line.trim()) {
              allLines.push(line);
            }
          }

          // Get last 200 lines and filter for stream refresh logs
          const streamRefreshLines = allLines
            .slice(-200)
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
          const fileStream = fs.createReadStream(logFilePath);
          const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
          });

          const allLines = [];
          for await (const line of rl) {
            if (line.trim()) {
              allLines.push(line);
            }
          }

          const filteredLines = allLines
            .slice(-200)
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
 * GET /api/monitoring/image-host-migration-status
 * Returns the current state of the bulk fallback-URL migration job.
 */
const getImageHostMigrationStatus = (req, res) => {
  res.json({ success: true, ...imageHostMigrationState });
};

/**
 * POST /api/monitoring/image-host-migration-trigger
 * Kicks off the background job that uploads all existing covers to S3 object storage.
 * Idempotent — if a run is already in progress, returns its status.
 */
const triggerImageHostMigration = async (req, res) => {
  if (imageHostMigrationState.status === 'running') {
    return res.json({ success: true, alreadyRunning: true, ...imageHostMigrationState });
  }

  const storageProvider = req.app.locals.storageProvider;
  if (!storageProvider) {
    return res.status(503).json({ success: false, error: 'Storage provider not available' });
  }

  // Respond immediately so the client isn't blocked
  imageHostMigrationState.status = 'running';
  imageHostMigrationState.startedAt = new Date().toISOString();
  imageHostMigrationState.completedAt = null;
  imageHostMigrationState.total = 0;
  imageHostMigrationState.processed = 0;
  imageHostMigrationState.succeeded = 0;
  imageHostMigrationState.failed = 0;
  imageHostMigrationState.lastError = null;

  res.json({ success: true, started: true, ...imageHostMigrationState });

  (async () => {
    const objectStorage = require('../services/objectStorageService');
    const logger = require('../middleware/logger');
    const BATCH = 100; // DB page size
    const CONCURRENCY = 2; // parallel uploads — keep low so /health stays responsive
    const DELAY_MS = 300; // pause between concurrency chunks (yields the event loop)
    // If uploads fail in a long unbroken streak (e.g. bad credentials or the
    // bucket is unreachable), abort rather than churning every remaining row.
    const MAX_CONSECUTIVE_FAILURES = 60;
    let offset = 0;
    let consecutiveFailures = 0;
    let aborted = false;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    try {
      if (!objectStorage.isEnabled()) {
        throw new Error(
          'object storage not configured — set S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY'
        );
      }

      // Count cover rows not yet copied to object storage
      const countRow = await storageProvider.tursoClient.execute(
        `SELECT COUNT(*) as c FROM images WHERE image_type='cover' AND pixhost_url IS NOT NULL AND storage_key IS NULL`
      );
      imageHostMigrationState.total = countRow?.rows?.[0]?.c || 0;

      logger.info(`[ImageHostMigration] Starting — ${imageHostMigrationState.total} covers to move to object storage`);

      while (!aborted) {
        const rows = await storageProvider.images.getImagesNeedingMigration(BATCH, offset);
        if (!rows || rows.length === 0) break;

        for (let i = 0; i < rows.length && !aborted; i += CONCURRENCY) {
          const chunk = rows.slice(i, i + CONCURRENCY);
          await Promise.all(
            chunk.map(async (row) => {
              try {
                // Use original_url as source for upload (or pixhost_url as fallback)
                const source = row.original_url || row.pixhost_url;
                const { key, error } = await objectStorage.uploadCoverFromUrl({
                  torrentKey: row.torrent_key,
                  imageUrl: source,
                  isFavorite: !!row.is_favorite,
                });
                if (key) {
                  // Store a presigned URL + the key (for later refresh), drop fallbacks.
                  const presigned = await objectStorage.getPresignedUrl(key);
                  await storageProvider.images.updateCoverStorage(row.torrent_key, presigned, key);
                  imageHostMigrationState.succeeded++;
                  consecutiveFailures = 0;
                } else {
                  // Nothing stored → row still has storage_key NULL. Count it as
                  // failed so the offset advances past it.
                  imageHostMigrationState.failed++;
                  consecutiveFailures++;
                  if (error) imageHostMigrationState.lastError = error;
                }
              } catch (e) {
                imageHostMigrationState.failed++;
                consecutiveFailures++;
                imageHostMigrationState.lastError = e.message;
              } finally {
                imageHostMigrationState.processed++;
              }
            })
          );

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            aborted = true;
            logger.error(
              `[ImageHostMigration] Aborting after ${consecutiveFailures} consecutive failures. Last error: ${imageHostMigrationState.lastError}`
            );
            break;
          }
          await sleep(DELAY_MS);
        }

        // Migrated rows get storage_key set and drop out of the set; every row
        // left behind the cursor is a failed one (oldest first by created_at).
        // Advancing the offset to the failed count skips exactly those, so the
        // run processes each row once and terminates.
        offset = imageHostMigrationState.failed;
      }

      if (aborted) {
        imageHostMigrationState.status = 'error';
        imageHostMigrationState.lastError =
          `Aborted after consecutive upload failures: ${imageHostMigrationState.lastError}`;
      } else {
        imageHostMigrationState.status = 'completed';
      }
      imageHostMigrationState.completedAt = new Date().toISOString();
      logger.info(`[ImageHostMigration] Done — ${imageHostMigrationState.succeeded} succeeded, ${imageHostMigrationState.failed} failed`);
    } catch (err) {
      imageHostMigrationState.status = 'error';
      imageHostMigrationState.lastError = err.message;
      imageHostMigrationState.completedAt = new Date().toISOString();
      logger.error(`[ImageHostMigration] Fatal error: ${err.message}`);
    }
  })();
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
  getImageHostMigrationStatus,
  triggerImageHostMigration,
  isImageMigrationRunning: () => imageHostMigrationState.status === 'running',
  triggerCoverStorageMaintenance,
};
