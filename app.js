// ===========================
// IMPORTS AND ENVIRONMENT SETUP
// ===========================

// Load environment configuration
const { config, validateEnvironment } = require('./config/environment');
const logger = require('./middleware/logger');
const { corsMiddleware, validateCorsConfig } = require('./middleware/cors');
const {
  errorHandler,
  notFoundHandler,
  asyncHandler,
} = require('./middleware/errorHandler');

// Core dependencies
const express = require('express');
const path = require('path');
const passport = require('passport');
const StorageProvider = require('./database/StorageProvider');
const healthRoutes = require('./routes/health');
const setupAuthRoutes = require('./routes/auth');
const setupTorrentRoutes = require('./routes/torrents');
const setupImageRoutes = require('./routes/images');
const AuthMiddleware = require('./middleware/auth');
const IpAllowlistMiddleware = require('./middleware/ipAllowlist');

// Controllers
const cacheController = require('./controllers/storageController');
const favoritesController = require('./controllers/favoritesController');
const videoController = require('./controllers/videoController');
const proxyController = require('./controllers/proxyController');
const monitoringController = require('./controllers/monitoringController');
const jobLogsController = require('./controllers/jobLogsController');
const { runWithJobFileLogging } = require('./services/backgroundJobFileLogger');

// ===========================
// ENVIRONMENT VALIDATION
// ===========================

// Validate environment on startup
const envErrors = validateEnvironment();
const corsErrors = validateCorsConfig();

if (envErrors.length > 0) {
  logger.error('Environment validation failed', { errors: envErrors });
  if (config.isProduction) {
    process.exit(1);
  }
}

if (corsErrors.length > 0) {
  logger.warn('CORS configuration issues', { errors: corsErrors });
}

// ===========================
// APPLICATION CONFIGURATION
// ===========================

const app = express();

// Trust proxy in production
if (config.security.trustProxy) {
  app.set('trust proxy', 1);
}

// ===========================
// DATABASE INITIALIZATION
// ===========================

// Initialize storage provider (uses Turso cloud database)
let storageProvider = null;
let authMiddleware = null;

// Database initialization can be added later if needed

// ===========================
// MIDDLEWARE SETUP
// ===========================

// Request logging middleware
app.use(logger.requestMiddleware());

// API usage tracking middleware
app.use(monitoringController.apiTrackingMiddleware());

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS middleware with environment-specific configuration
app.use(corsMiddleware());

// Initialize passport middleware
app.use(passport.initialize());

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));

// ===========================
// ROUTE DEFINITIONS
// ===========================

// Health check routes (before other routes)
app.use('/', healthRoutes);

// Initialize a minimal cache for auth routes during startup

// Note: Server startup will happen after async initialization completes

// --- CACHE ROUTES ---

app.get('/api/cache/stats', cacheController.getStats);

// Note: Monitoring routes are registered in startServer() after ipAllowlistMiddleware is initialized

// Debug endpoint to check favorites data - Note: registered in startServer()
app.get('/api/monitoring/debug-favorites', async (req, res) => {
  try {
    const storage = req.app.locals.storageProvider;
    if (!storage) {
      return res.json({ error: 'No storage provider' });
    }

    const stats = await storage.favorites.getStats();

    const sampleEntries = await storage.tursoClient.client.execute(
      'SELECT id, torrent_key, magnet_link, torrent_name, substr(torrent_data, 1, 500) as torrent_data_preview FROM favorite_entries LIMIT 3'
    );

    const refreshData = await storage.favorites.getAllFavoritesForStreamRefresh();

    res.json({
      stats,
      sampleFavoriteEntries: sampleEntries.rows,
      refreshQueryResult: refreshData
    });
  } catch (error) {
    res.json({ error: error.message, stack: error.stack });
  }
});

app.post('/api/cache/cover-image', cacheController.storeCoverImage);
app.get('/api/cache/cover-image/:torrentKey', cacheController.getCoverImage);
app.post(
  '/api/cache/cover-image/torrent',
  cacheController.getCoverImageForTorrent
);
app.post('/api/cache/stream-url', cacheController.storeStreamUrl);
app.get('/api/cache/stream-url/:magnetHash', cacheController.getStreamUrl);
app.post('/api/cache/stream-url/refresh', cacheController.refreshStreamUrl);
app.post('/api/cache/magnet', cacheController.storeMagnetLink);
app.get('/api/cache/magnet', cacheController.getMagnetLink);
// Note: Cached links routes moved to startServer() for proper auth middleware
app.post('/api/cache/set', cacheController.setCacheValue);
app.get('/api/cache/get/:key', cacheController.getCacheValue);
app.delete('/api/cache/delete/:key', cacheController.deleteCacheValue);

// --- FAVORITES ROUTES ---
// Note: These will be registered after authMiddleware is initialized in startServer()

// --- IMAGE ROUTES ---
// Note: These will be registered in startServer() using setupImageRoutes()

// --- VIDEO ROUTES ---
app.post('/api/video/screenshot', videoController.generateScreenshot);
app.post('/api/video/screenshots', videoController.getCachedScreenshotsPost);
app.get(
  '/api/video/screenshots/:magnetLink',
  videoController.getCachedScreenshotsGet
);
app.post(
  '/api/video/batch-screenshots',
  videoController.generateBatchScreenshots
);

// --- TORRENT ROUTES ---
// Note: These will be registered in startServer() using setupTorrentRoutes()

// --- PROXY ROUTES ---
// Note: MUST be before the catch-all torrent search route
app.options('/api/proxy/*', proxyController.handleCorsOptions);
app.all('/api/proxy/real-debrid/*', proxyController.realDebridProxy);

// --- MAIN SEARCH ROUTE ---
// Note: This will be registered after auth routes to avoid conflicts

// --- STATIC ROUTES ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- CATCH-ALL TORRENT SEARCH ROUTE ---
// Note: This will be registered after auth routes to avoid conflicts

// ===========================
// SERVER STARTUP
// ===========================

// Server startup will happen after async initialization
async function startServer() {
  try {
    // Initialize storage provider and database first with timeout
    logger.info('Starting database initialization...');

    storageProvider = new StorageProvider();

    // Add timeout to database initialization
    const initPromise = storageProvider.initialize().then(() => {
      logger.info('Database initialization completed successfully');
    }).catch((err) => {
      logger.error('Database initialization failed:', { error: err.message, stack: err.stack });
      throw err;
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Database initialization timeout after 60s')),
        60000
      )
    );

    await Promise.race([initPromise, timeoutPromise]);
    app.locals.storageProvider = storageProvider;
    // Backward compatibility: expose as storage and cache
    app.locals.storage = storageProvider;
    app.locals.cache = storageProvider;

    // Initialize auth middleware
    authMiddleware = new AuthMiddleware(storageProvider);

    // Initialize IP allowlist middleware for monitoring endpoints
    const ipAllowlistMiddleware = new IpAllowlistMiddleware();
    const ipRestricted = ipAllowlistMiddleware.restrictToAllowlist();

    // Register monitoring routes with IP restriction
    app.get('/api/monitoring/dashboard', ipRestricted, monitoringController.getDashboardData);
    app.get('/api/monitoring/logs', ipRestricted, monitoringController.getLogs);
    app.get('/api/monitoring/tasks', ipRestricted, monitoringController.getBackgroundTaskStats);
    app.get('/api/monitoring/api-usage', ipRestricted, monitoringController.getApiUsageStats);
    app.get('/api/monitoring/stream-url-refresh-logs', ipRestricted, monitoringController.getStreamUrlRefreshLogs);
    app.post('/api/monitoring/stream-url-refresh-trigger', ipRestricted, monitoringController.triggerStreamUrlRefresh);
    app.get('/api/monitoring/description-image-cache-logs', ipRestricted, monitoringController.getDescriptionImageCacheLogs);
    app.post('/api/monitoring/description-image-cache-trigger', ipRestricted, monitoringController.triggerDescriptionImageCache);
    app.post('/api/monitoring/description-image-cache-force-refresh', ipRestricted, monitoringController.triggerDescriptionImageCacheForceRefresh);
    app.get('/api/monitoring/search-results-cache-logs', ipRestricted, monitoringController.getSearchResultsCacheLogs);
    app.post('/api/monitoring/search-results-cache-trigger', ipRestricted, monitoringController.triggerSearchResultsCache);
    app.get('/api/monitoring/image-host-migration-status', ipRestricted, monitoringController.getImageHostMigrationStatus);
    app.post('/api/monitoring/image-host-migration-trigger', ipRestricted, monitoringController.triggerImageHostMigration);
    app.get('/api/monitoring/job-logs/list', ipRestricted, jobLogsController.listJobLogs);
    app.get('/api/monitoring/job-logs/search', ipRestricted, jobLogsController.searchJobLogs);
    app.get('/api/monitoring/job-logs/file', ipRestricted, jobLogsController.serveJobLogFile);
    app.post('/api/monitoring/job-logs/maintenance', ipRestricted, jobLogsController.triggerJobLogMaintenance);
    app.get('/api/monitoring/debug-favorites', ipRestricted, async (req, res) => {
      try {
        const storage = req.app.locals.storageProvider;
        if (!storage) {
          return res.json({ error: 'No storage provider' });
        }
        const stats = await storage.favorites.getStats();
        const sampleEntries = await storage.tursoClient.client.execute(
          'SELECT id, torrent_key, magnet_link, torrent_name, substr(torrent_data, 1, 500) as torrent_data_preview FROM favorite_entries LIMIT 3'
        );
        const refreshData = await storage.favorites.getAllFavoritesForStreamRefresh();
        res.json({ stats, sampleFavoriteEntries: sampleEntries.rows, refreshQueryResult: refreshData });
      } catch (error) {
        res.json({ error: error.message, stack: error.stack });
      }
    });

    // Register auth routes
    const authRouter = setupAuthRoutes(storageProvider);
    app.use('/api/auth', authRouter);

    // Register image routes
    const imageRouter = setupImageRoutes(storageProvider);
    app.use('/api/images', imageRouter);

    // Register old image route paths for backward compatibility
    app.use('/api/google-images', imageRouter);
    app.use('/api/pixhost', imageRouter);
    app.use('/api/proxy', imageRouter);

    // Register torrent routes
    const torrentRouter = setupTorrentRoutes(storageProvider);
    app.use('/api/torrents', torrentRouter);

    // Now register favorites routes with proper auth middleware
    // Note: Backward compatibility torrent routes will be added at the end

    // --- FAVORITES CACHE ROUTES ---
    app.post(
      '/api/cache/favorites',
      authMiddleware.requireAuth(),
      favoritesController.addFavorite
    );
    app.get(
      '/api/cache/favorites',
      authMiddleware.requireAuth(),
      favoritesController.getFavorites
    );
    app.delete(
      '/api/cache/favorites',
      authMiddleware.requireAuth(),
      favoritesController.removeFavorite
    );
    app.get(
      '/api/favorites/:favoriteId/details',
      authMiddleware.requireAuth(),
      favoritesController.getFavoriteDetails
    );
    app.post(
      '/api/favorites/:favoriteId/details',
      authMiddleware.requireAuth(),
      favoritesController.storeFavoriteDetails
    );
    app.get(
      '/api/favorites/:favoriteId/screenshots',
      authMiddleware.requireAuth(),
      favoritesController.getFavoriteScreenshots
    );
    app.post(
      '/api/favorites/:favoriteId/screenshots',
      authMiddleware.requireAuth(),
      favoritesController.storeFavoriteScreenshots
    );
    app.post(
      '/api/favorites/check',
      authMiddleware.requireAuth(),
      favoritesController.checkFavorite
    );
    app.post(
      '/api/favorites/entry',
      authMiddleware.requireAuth(),
      favoritesController.storeFavoriteEntry
    );

    // --- FAVORITES STORAGE ROUTES ---
    // Frontend calls /api/storage/favorites instead of /api/cache/favorites
    app.post(
      '/api/storage/favorites',
      authMiddleware.requireAuth(),
      favoritesController.addFavorite
    );
    app.get(
      '/api/storage/favorites',
      authMiddleware.requireAuth(),
      favoritesController.getFavorites
    );
    app.delete(
      '/api/storage/favorites',
      authMiddleware.requireAuth(),
      favoritesController.removeFavorite
    );

    // --- STORAGE ROUTES FOR CACHED LINKS ---

    const optionalAuthFn = authMiddleware?.optionalAuth();

    app.post(
      '/api/storage/stored-links',
      (req, res, next) => {
        next();
      },
      (req, res, next) => {
        next();
      },
      optionalAuthFn,
      (req, res, next) => {
        next();
      },
      cacheController.addCachedLink
    );
    app.get(
      '/api/storage/stored-links',
      authMiddleware.optionalAuth(),
      cacheController.getCachedLinks
    );
    app.delete(
      '/api/storage/stored-links/:id',
      authMiddleware.optionalAuth(),
      cacheController.removeCachedLink
    );
    app.put(
      '/api/storage/stored-links/:id',
      authMiddleware.optionalAuth(),
      cacheController.updateCachedLink
    );

    // --- OTHER STORAGE ROUTES ---
    app.post('/api/storage/stream-url', cacheController.storeStreamUrl);
    app.get(
      '/api/storage/stream-url/:magnetHash',
      cacheController.getStreamUrl
    );
    app.post(
      '/api/storage/stream-url/refresh',
      cacheController.refreshStreamUrl
    );
    app.post('/api/storage/cover-image', cacheController.storeCoverImage);
    app.get(
      '/api/storage/cover-image/:torrentKey',
      cacheController.getCoverImage
    );
    app.post(
      '/api/storage/cover-image/torrent',
      cacheController.getCoverImageForTorrent
    );

    // Update favorite entry magnet link
    app.put(
      '/api/storage/favorites/:favoriteId/magnet',
      authMiddleware.optionalAuth(),
      cacheController.updateFavoriteEntryMagnetLink
    );

    // Debug endpoint for troubleshooting favorite entries
    app.get('/api/debug/favorite-entry/:favoriteEntryId', async (req, res) => {
      try {
        const storageProvider = req.app.locals.storageProvider;
        const { favoriteEntryId } = req.params;

        const sql = 'SELECT * FROM favorite_entries WHERE id = ?';
        const row = await storageProvider.tursoClient.get(sql, [
          favoriteEntryId,
        ]);

        res.json({
          success: true,
          favoriteEntryId,
          found: !!row,
          data: row,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });
    app.post('/api/storage/set', cacheController.setCacheValue);
    app.get('/api/storage/get/:key', cacheController.getCacheValue);
    app.delete('/api/storage/delete/:key', cacheController.deleteCacheValue);

    // --- CACHED LINKS ROUTES WITH OPTIONAL AUTH ---
    app.post(
      '/api/cache/cached-links',
      authMiddleware.optionalAuth(),
      cacheController.addCachedLink
    );
    app.get(
      '/api/cache/cached-links',
      authMiddleware.optionalAuth(),
      cacheController.getCachedLinks
    );
    app.delete(
      '/api/cache/cached-links/:id',
      authMiddleware.optionalAuth(),
      cacheController.removeCachedLink
    );
    app.put(
      '/api/cache/cached-links/:id',
      authMiddleware.optionalAuth(),
      cacheController.updateCachedLink
    );

    // --- BACKWARD COMPATIBILITY TORRENT ROUTES ---
    // IMPORTANT: This must be LAST to avoid catching other /api/* routes
    // Backward compatibility for old torrent routes (e.g., /api/:website/:query/:page)
    app.use('/api', torrentRouter);

    // Add error handling middleware after all routes are registered
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Now start the server

    const PORT = process.env.PORT || 3001;

    const server = app.listen(PORT, () => {});

    // Start periodic tasks after successful initialization
    startPeriodicStorageCleanup();
    // TODO: Re-enable after fixing DB init issue
    // startPeriodicTokenRefresh();
    startPeriodicStreamUrlRefresh();
    startPeriodicDescriptionImageCache();
    startPeriodicSearchResultsCache();
    startPeriodicJobLogMaintenance();
    startPeriodicCoverStorageMaintenance();

    return server;
  } catch (error) {
    logger.error('Failed to initialize application:', error);

    // Initialize minimal storage without database
    storageProvider = new StorageProvider();
    app.locals.storageProvider = storageProvider;
    // Backward compatibility
    app.locals.storage = storageProvider;
    app.locals.cache = storageProvider;

    // Initialize auth middleware (will handle database unavailability gracefully)
    authMiddleware = new AuthMiddleware(storageProvider);

    // Initialize IP allowlist middleware for monitoring endpoints
    const ipAllowlistMiddleware = new IpAllowlistMiddleware();
    const ipRestricted = ipAllowlistMiddleware.restrictToAllowlist();

    // Register monitoring routes with IP restriction (fallback)
    app.get('/api/monitoring/dashboard', ipRestricted, monitoringController.getDashboardData);
    app.get('/api/monitoring/logs', ipRestricted, monitoringController.getLogs);
    app.get('/api/monitoring/tasks', ipRestricted, monitoringController.getBackgroundTaskStats);
    app.get('/api/monitoring/api-usage', ipRestricted, monitoringController.getApiUsageStats);
    app.get('/api/monitoring/stream-url-refresh-logs', ipRestricted, monitoringController.getStreamUrlRefreshLogs);
    app.post('/api/monitoring/stream-url-refresh-trigger', ipRestricted, monitoringController.triggerStreamUrlRefresh);
    app.get('/api/monitoring/description-image-cache-logs', ipRestricted, monitoringController.getDescriptionImageCacheLogs);
    app.post('/api/monitoring/description-image-cache-trigger', ipRestricted, monitoringController.triggerDescriptionImageCache);
    app.post('/api/monitoring/description-image-cache-force-refresh', ipRestricted, monitoringController.triggerDescriptionImageCacheForceRefresh);
    app.get('/api/monitoring/search-results-cache-logs', ipRestricted, monitoringController.getSearchResultsCacheLogs);
    app.post('/api/monitoring/search-results-cache-trigger', ipRestricted, monitoringController.triggerSearchResultsCache);
    app.get('/api/monitoring/image-host-migration-status', ipRestricted, monitoringController.getImageHostMigrationStatus);
    app.post('/api/monitoring/image-host-migration-trigger', ipRestricted, monitoringController.triggerImageHostMigration);
    app.get('/api/monitoring/job-logs/list', ipRestricted, jobLogsController.listJobLogs);
    app.get('/api/monitoring/job-logs/search', ipRestricted, jobLogsController.searchJobLogs);
    app.get('/api/monitoring/job-logs/file', ipRestricted, jobLogsController.serveJobLogFile);
    app.post('/api/monitoring/job-logs/maintenance', ipRestricted, jobLogsController.triggerJobLogMaintenance);
    app.get('/api/monitoring/debug-favorites', ipRestricted, async (req, res) => {
      try {
        const storage = req.app.locals.storageProvider;
        if (!storage) {
          return res.json({ error: 'No storage provider' });
        }
        const stats = await storage.favorites.getStats();
        const sampleEntries = await storage.tursoClient.client.execute(
          'SELECT id, torrent_key, magnet_link, torrent_name, substr(torrent_data, 1, 500) as torrent_data_preview FROM favorite_entries LIMIT 3'
        );
        const refreshData = await storage.favorites.getAllFavoritesForStreamRefresh();
        res.json({ stats, sampleFavoriteEntries: sampleEntries.rows, refreshQueryResult: refreshData });
      } catch (error) {
        res.json({ error: error.message, stack: error.stack });
      }
    });

    // Register auth routes with minimal setup
    const authRouter = setupAuthRoutes(storageProvider);
    app.use('/api/auth', authRouter);

    // Register image routes
    const imageRouter = setupImageRoutes(storageProvider);
    app.use('/api/images', imageRouter);
    app.use('/api/google-images', imageRouter);
    app.use('/api/pixhost', imageRouter);
    app.use('/api/proxy', imageRouter);

    // Register torrent routes
    const torrentRouter = setupTorrentRoutes(storageProvider);
    app.use('/api/torrents', torrentRouter);

    // Register favorites routes (with fallback auth middleware)
    // Note: Backward compatibility torrent routes will be added at the end

    // --- FAVORITES CACHE ROUTES ---
    app.post(
      '/api/cache/favorites',
      authMiddleware.requireAuth(),
      favoritesController.addFavorite
    );
    app.get(
      '/api/cache/favorites',
      authMiddleware.requireAuth(),
      favoritesController.getFavorites
    );
    app.delete(
      '/api/cache/favorites',
      authMiddleware.requireAuth(),
      favoritesController.removeFavorite
    );
    app.get(
      '/api/favorites/:favoriteId/details',
      authMiddleware.requireAuth(),
      favoritesController.getFavoriteDetails
    );
    app.post(
      '/api/favorites/:favoriteId/details',
      authMiddleware.requireAuth(),
      favoritesController.storeFavoriteDetails
    );
    app.get(
      '/api/favorites/:favoriteId/screenshots',
      authMiddleware.requireAuth(),
      favoritesController.getFavoriteScreenshots
    );
    app.post(
      '/api/favorites/:favoriteId/screenshots',
      authMiddleware.requireAuth(),
      favoritesController.storeFavoriteScreenshots
    );
    app.post(
      '/api/favorites/check',
      authMiddleware.requireAuth(),
      favoritesController.checkFavorite
    );
    app.post(
      '/api/favorites/entry',
      authMiddleware.requireAuth(),
      favoritesController.storeFavoriteEntry
    );

    // --- FAVORITES STORAGE ROUTES ---
    app.post(
      '/api/storage/favorites',
      authMiddleware.requireAuth(),
      favoritesController.addFavorite
    );
    app.get(
      '/api/storage/favorites',
      authMiddleware.requireAuth(),
      favoritesController.getFavorites
    );
    app.delete(
      '/api/storage/favorites',
      authMiddleware.requireAuth(),
      favoritesController.removeFavorite
    );

    // --- STORAGE ROUTES FOR CACHED LINKS (FALLBACK) ---
    app.post(
      '/api/storage/stored-links',
      authMiddleware.optionalAuth(),
      cacheController.addCachedLink
    );
    app.get(
      '/api/storage/stored-links',
      authMiddleware.optionalAuth(),
      cacheController.getCachedLinks
    );
    app.delete(
      '/api/storage/stored-links/:id',
      authMiddleware.optionalAuth(),
      cacheController.removeCachedLink
    );
    app.put(
      '/api/storage/stored-links/:id',
      authMiddleware.optionalAuth(),
      cacheController.updateCachedLink
    );

    // --- OTHER STORAGE ROUTES (FALLBACK) ---
    app.post('/api/storage/stream-url', cacheController.storeStreamUrl);
    app.get(
      '/api/storage/stream-url/:magnetHash',
      cacheController.getStreamUrl
    );
    app.post(
      '/api/storage/stream-url/refresh',
      cacheController.refreshStreamUrl
    );
    app.post('/api/storage/cover-image', cacheController.storeCoverImage);
    app.get(
      '/api/storage/cover-image/:torrentKey',
      cacheController.getCoverImage
    );
    app.post(
      '/api/storage/cover-image/torrent',
      cacheController.getCoverImageForTorrent
    );

    // Update favorite entry magnet link (fallback)
    app.put(
      '/api/storage/favorites/:favoriteId/magnet',
      authMiddleware.optionalAuth(),
      cacheController.updateFavoriteEntryMagnetLink
    );

    app.post('/api/storage/set', cacheController.setCacheValue);
    app.get('/api/storage/get/:key', cacheController.getCacheValue);
    app.delete('/api/storage/delete/:key', cacheController.deleteCacheValue);

    // --- CACHED LINKS ROUTES WITH OPTIONAL AUTH (FALLBACK) ---
    app.post(
      '/api/cache/cached-links',
      authMiddleware.optionalAuth(),
      cacheController.addCachedLink
    );
    app.get(
      '/api/cache/cached-links',
      authMiddleware.optionalAuth(),
      cacheController.getCachedLinks
    );
    app.delete(
      '/api/cache/cached-links/:id',
      authMiddleware.optionalAuth(),
      cacheController.removeCachedLink
    );
    app.put(
      '/api/cache/cached-links/:id',
      authMiddleware.optionalAuth(),
      cacheController.updateCachedLink
    );

    // --- BACKWARD COMPATIBILITY TORRENT ROUTES (FALLBACK) ---
    // IMPORTANT: This must be LAST to avoid catching other /api/* routes
    // Backward compatibility for old torrent routes (e.g., /api/:website/:query/:page)
    app.use('/api', torrentRouter);

    // Add error handling middleware after all routes are registered
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Start server
    const PORT = process.env.PORT || 3001;
    const server = app.listen(PORT, () => {});

    return server;
  }
}

// Start the server with proper async initialization
let server;
(async () => {
  server = await startServer();
})();

// ===========================
// CLEANUP AND SHUTDOWN HANDLERS
// ===========================

// Graceful shutdown handler
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);

  server.close(async () => {
    logger.info('HTTP server closed');

    if (storageProvider) {
      try {
        await storageProvider.cleanup();
        await storageProvider.close();
        logger.info('Database connections closed');
      } catch (error) {
        logger.error('Error during database cleanup', { error: error.message });
      }
    }

    logger.info('Graceful shutdown completed');
    process.exit(0);
  });

  // Force exit after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Register shutdown signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Periodic storage cleanup handler
const startPeriodicStorageCleanup = () => {
  if (!storageProvider) {
    logger.warn('Storage not available - skipping periodic cleanup');
    return;
  }

  const cleanupInterval = 60 * 60 * 1000; // 1 hour
  logger.info('Starting periodic storage cleanup', {
    intervalMinutes: cleanupInterval / (60 * 1000),
    cleanupScope:
      'Expired cache entries and old stream URLs (keeps 100 most recent)',
  });

  // Initialize next run time
  monitoringController.backgroundTaskStats.storageCleanup.nextRun = new Date(Date.now() + cleanupInterval).toISOString();

  setInterval(async () => {
    await runWithJobFileLogging('storageCleanup', async () => {
      try {
        logger.info('Running periodic storage cleanup', {
          cleanupTypes: ['expired_cache_entries', 'old_stream_urls'],
          note: 'Favorites, images, and non-expired data are preserved',
        });
        await storageProvider.cleanup();
        logger.info('Periodic storage cleanup completed successfully');
        monitoringController.updateTaskStats('storageCleanup', { success: true });
      } catch (error) {
        logger.error('Error during scheduled cleanup', { error: error.message });
        monitoringController.updateTaskStats('storageCleanup', { success: false, error: error.message });
      }
    });
  }, cleanupInterval);
};

// Periodic cover object-storage maintenance: refresh presigned URLs (so they
// never lapse) and delete expired non-favorite ("temp") covers.
const startPeriodicCoverStorageMaintenance = () => {
  if (!storageProvider) {
    logger.warn('Storage not available - skipping cover storage maintenance');
    return;
  }
  const objectStorage = require('./services/objectStorageService');
  if (!objectStorage.isEnabled()) {
    logger.info('Object storage not configured - skipping cover storage maintenance');
    return;
  }
  const maint = require('./services/coverStorageMaintenanceService');
  const REFRESH_INTERVAL = 3 * 24 * 60 * 60 * 1000; // every 3 days (presigned URLs valid 7)
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // daily

  const runRefresh = () =>
    runWithJobFileLogging('coverPresignRefresh', async () => {
      try {
        await maint.refreshPresignedUrls(storageProvider, logger);
      } catch (e) {
        logger.error('Cover presign refresh failed', { error: e.message });
      }
    });
  const runCleanup = () =>
    runWithJobFileLogging('coverTempCleanup', async () => {
      try {
        await maint.cleanupExpiredTemp(storageProvider, logger);
      } catch (e) {
        logger.error('Cover temp cleanup failed', { error: e.message });
      }
    });

  // Initial runs shortly after startup, then on a schedule.
  setTimeout(runRefresh, 2 * 60 * 1000);
  setInterval(runRefresh, REFRESH_INTERVAL);
  setTimeout(runCleanup, 15 * 60 * 1000);
  setInterval(runCleanup, CLEANUP_INTERVAL);

  logger.info('Started cover storage maintenance (presigned refresh every 3d, temp cleanup daily)');
};

// Periodic Google token refresh handler
const startPeriodicTokenRefresh = () => {
  if (!storageProvider) {
    logger.warn('Storage not available - skipping token refresh');
    return;
  }

  const AuthService = require('./config/passport');
  const authService = new AuthService(storageProvider);

  // Google access tokens expire in 1 hour, refresh every 45 minutes
  const refreshInterval = 45 * 60 * 1000; // 45 minutes
  logger.info('Starting periodic Google token refresh', {
    intervalMinutes: refreshInterval / (60 * 1000),
    note: 'Keeps user sessions alive by refreshing Google access tokens',
  });

  // Run initial refresh after 1 minute to let server fully initialize
  setTimeout(async () => {
    try {
      const result = await authService.refreshAllGoogleTokens();
      if (result.refreshed > 0 || result.failed > 0) {
        logger.info('Initial Google token refresh completed', result);
      }
    } catch (error) {
      logger.error('Error during initial token refresh', { error: error.message });
    }
  }, 60 * 1000);

  // Then run periodically
  setInterval(async () => {
    try {
      const result = await authService.refreshAllGoogleTokens();
      if (result.refreshed > 0 || result.failed > 0) {
        logger.info('Periodic Google token refresh completed', result);
      }
    } catch (error) {
      logger.error('Error during scheduled token refresh', { error: error.message });
    }
  }, refreshInterval);
};

// Periodic stream URL refresh for favorites
const startPeriodicStreamUrlRefresh = () => {
  if (!storageProvider) {
    logger.warn('Storage not available - skipping stream URL refresh');
    return;
  }

  const StreamUrlRefreshService = require('./services/streamUrlRefreshService');
  const AuthService = require('./config/passport');
  const authService = new AuthService(storageProvider);
  const refreshService = new StreamUrlRefreshService(storageProvider, authService);

  const refreshInterval = 24 * 60 * 60 * 1000; // 24 hours
  const initialDelay = 70 * 1000; // 70 seconds
  logger.info('Starting periodic stream URL refresh for favorites', {
    intervalHours: refreshInterval / (60 * 60 * 1000),
    note: 'Refreshes Real-Debrid stream URLs for all favorites with magnet links',
  });

  // Align monitoring nextRun with the initial setTimeout below (same initialDelay)
  monitoringController.backgroundTaskStats.streamUrlRefresh.nextRun = new Date(Date.now() + initialDelay).toISOString();

  // Run initial refresh after 70 seconds to let server fully initialize
  setTimeout(async () => {
    await runWithJobFileLogging('streamUrlRefresh', async () => {
      try {
        monitoringController.backgroundTaskStats.streamUrlRefresh.status = 'running';

        logger.info('Running initial stream URL refresh for favorites');
        logger.info('Stream URL refresh service initialized', {
          hasStorage: !!storageProvider,
          hasFavorites: !!storageProvider?.favorites
        });
        const result = await refreshService.refreshAllFavoriteStreamUrls();
        logger.info('Initial stream URL refresh completed', {
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
        monitoringController.updateTaskStats('streamUrlRefresh', {
          success: true,
          totalFavorites: result.totalFavorites,
          usersProcessed: result.usersProcessed,
          refreshed: result.refreshed,
          retriedSuccesses: result.retriedSuccesses,
          skipped: result.skipped,
          failed: result.failed,
        });
      } catch (error) {
        logger.error('Error during initial stream URL refresh', { error: error.message });
        monitoringController.updateTaskStats('streamUrlRefresh', { success: false, error: error.message });
      }
    });
  }, initialDelay);

  // Then run every 24 hours
  setInterval(async () => {
    await runWithJobFileLogging('streamUrlRefresh', async () => {
      try {
        monitoringController.backgroundTaskStats.streamUrlRefresh.status = 'running';

        logger.info('Running periodic stream URL refresh for favorites');
        const result = await refreshService.refreshAllFavoriteStreamUrls();
        logger.info('Periodic stream URL refresh completed', {
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
        monitoringController.updateTaskStats('streamUrlRefresh', {
          success: true,
          totalFavorites: result.totalFavorites,
          usersProcessed: result.usersProcessed,
          refreshed: result.refreshed,
          retriedSuccesses: result.retriedSuccesses,
          skipped: result.skipped,
          failed: result.failed,
        });
      } catch (error) {
        logger.error('Error during scheduled stream URL refresh', { error: error.message });
        monitoringController.updateTaskStats('streamUrlRefresh', { success: false, error: error.message });
      }
    });
  }, refreshInterval);
};

// Periodic description & image pre-cache job (piratebay Porn HD)
const startPeriodicDescriptionImageCache = () => {
  if (!storageProvider) {
    logger.warn('Storage not available - skipping description/image cache job');
    return;
  }

  const DescriptionImageCacheService = require('./services/descriptionImageCacheService');
  const cacheService = new DescriptionImageCacheService(storageProvider);

  const intervalMs = 6 * 60 * 60 * 1000; // 6 hours
  const initialDelay = 2 * 60 * 1000;     // 2 minutes after startup

  logger.info('Starting periodic description/image cache job', {
    intervalHours: intervalMs / (60 * 60 * 1000),
    note: 'Caches cover images for piratebay Porn HD: browse (6 pages) + xxx (5 pages) + trans (2 pages) + studios',
  });

  monitoringController.backgroundTaskStats.descriptionImageCache.nextRun =
    new Date(Date.now() + initialDelay).toISOString();

  const runJob = async (isInitial) => {
    await runWithJobFileLogging('descriptionImageCache', async () => {
      try {
        monitoringController.backgroundTaskStats.descriptionImageCache.status = 'running';
        logger.info(`Running ${isInitial ? 'initial' : 'periodic'} description/image cache job`);

        const result = await cacheService.runCacheJob();

        logger.info('Description/image cache job completed', {
          totalSearches: result.totalSearches,
          totalTorrents: result.totalTorrents,
          imagesFound: result.imagesFound,
          cached: result.cached,
          skipped: result.skipped,
          failed: result.failed,
        });

        if (result.errors.length > 0) {
          logger.warn('Description/image cache job had errors', { errors: result.errors.slice(0, 5) });
        }

        monitoringController.updateTaskStats('descriptionImageCache', {
          success: true,
          totalSearches: result.totalSearches,
          totalTorrents: result.totalTorrents,
          imagesFound: result.imagesFound,
          cached: result.cached,
          skipped: result.skipped,
          failed: result.failed,
        });
      } catch (error) {
        logger.error('Error during description/image cache job', { error: error.message });
        monitoringController.updateTaskStats('descriptionImageCache', {
          success: false,
          error: error.message,
        });
      }
    });
  };

  setTimeout(() => runJob(true), initialDelay);
  setInterval(() => runJob(false), intervalMs);
};

// Periodic stream URL pre-cache for filter page results (piratebay Porn HD — browse + trans 2 pages + studios)
// Same idea as the favourites stream refresh but targets the filter/browse pages so results are instantly streamable.
const startPeriodicSearchResultsCache = () => {
  if (!storageProvider) {
    logger.warn('Storage not available - skipping filter stream cache job');
    return;
  }

  const FilterStreamCacheService = require('./services/searchResultsCacheService');
  const StreamUrlRefreshService = require('./services/streamUrlRefreshService');
  const AuthService = require('./config/passport');
  const authService = new AuthService(storageProvider);
  const refreshService = new StreamUrlRefreshService(storageProvider, authService);

  const refreshInterval = 6 * 60 * 60 * 1000; // 6 hours — browse + trans (2) + studio filters
  const initialDelay = 3 * 60 * 1000;           // 3 minutes after startup

  logger.info('Starting periodic filter stream URL cache job', {
    intervalHours: refreshInterval / (60 * 60 * 1000),
    note: 'Refreshes RD stream URLs for browse (507, 6 pages) + trans (2 pages) + 2 pages per studio — always re-fetches (expired URLs replaced)',
  });

  monitoringController.backgroundTaskStats.searchResultsCache.nextRun =
    new Date(Date.now() + initialDelay).toISOString();

  const runJob = async (isInitial) => {
    await runWithJobFileLogging('searchResultsCache', async () => {
      try {
        monitoringController.backgroundTaskStats.searchResultsCache.status = 'running';
        logger.info(`Running ${isInitial ? 'initial' : 'periodic'} filter stream URL cache job`);

        const cacheService = new FilterStreamCacheService(storageProvider, refreshService, authService);
        const result = await cacheService.runCacheJob();

        logger.info('Filter stream URL cache job completed', {
          totalSearches: result.totalSearches,
          totalTorrents: result.totalTorrents,
          uniqueMagnets: result.uniqueMagnets,
          usersProcessed: result.usersProcessed,
          alreadyCached: result.alreadyCached,
          refreshed: result.refreshed,
          failed: result.failed,
        });

        if (result.errors.length > 0) {
          logger.warn('Filter stream cache job had errors', { errors: result.errors.slice(0, 5) });
        }

        monitoringController.updateTaskStats('searchResultsCache', {
          success: true,
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
        logger.error('Error during filter stream cache job', { error: error.message });
        monitoringController.updateTaskStats('searchResultsCache', {
          success: false,
          error: error.message,
        });
      }
    });
  };

  setTimeout(() => runJob(true), initialDelay);
  setInterval(() => runJob(false), refreshInterval);
};

// Compress idle job .log files and delete logs older than retention (see config.logging)
const startPeriodicJobLogMaintenance = () => {
  const { runMaintenance } = require('./services/backgroundJobLogMaintenance');
  const intervalMs = config.logging.backgroundJobLogMaintenanceIntervalMs;
  const initialDelay = config.logging.backgroundJobLogMaintenanceInitialDelayMs;

  logger.info('Scheduling background job log maintenance', {
    initialDelayMinutes: initialDelay / 60000,
    intervalHours: intervalMs / (60 * 60 * 1000),
    retentionDays: config.logging.backgroundJobLogRetentionDays,
    compressAfterHours: (config.logging.backgroundJobLogCompressAfterMs || 0) / (60 * 60 * 1000),
  });

  const tick = async () => {
    try {
      await runWithJobFileLogging('jobLogMaintenance', async () => {
        const result = await runMaintenance();
        logger.info('Scheduled job log maintenance finished', result);
      });
    } catch (error) {
      logger.error('Job log maintenance scheduler error', { error: error.message });
    }
  };

  setTimeout(() => {
    tick();
  }, initialDelay);
  setInterval(() => {
    tick();
  }, intervalMs);
};

module.exports = app;
