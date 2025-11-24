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

// Controllers
const cacheController = require('./controllers/storageController');
const favoritesController = require('./controllers/favoritesController');
const videoController = require('./controllers/videoController');
const proxyController = require('./controllers/proxyController');

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
app.post('/api/cache/cover-image', cacheController.storeCoverImage);
app.get('/api/cache/cover-image/:torrentKey', cacheController.getCoverImage);
app.post(
  '/api/cache/cover-image/torrent',
  cacheController.getCoverImageForTorrent
);
app.post('/api/cache/stream-url', cacheController.storeStreamUrl);
app.get('/api/cache/stream-url/:magnetHash', cacheController.getStreamUrl);
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

    storageProvider = new StorageProvider();

    // Add timeout to database initialization
    const initPromise = storageProvider.initialize();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Database initialization timeout')),
        30000
      )
    );

    await Promise.race([initPromise, timeoutPromise]);
    app.locals.storageProvider = storageProvider;
    // Backward compatibility: expose as storage and cache
    app.locals.storage = storageProvider;
    app.locals.cache = storageProvider;

    // Initialize auth middleware
    authMiddleware = new AuthMiddleware(storageProvider);

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
    app.post('/api/storage/cover-image', cacheController.storeCoverImage);
    app.get(
      '/api/storage/cover-image/:torrentKey',
      cacheController.getCoverImage
    );
    app.post(
      '/api/storage/cover-image/torrent',
      cacheController.getCoverImageForTorrent
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
    startPeriodicTokenRefresh();

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
    app.post('/api/storage/cover-image', cacheController.storeCoverImage);
    app.get(
      '/api/storage/cover-image/:torrentKey',
      cacheController.getCoverImage
    );
    app.post(
      '/api/storage/cover-image/torrent',
      cacheController.getCoverImageForTorrent
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

  setInterval(async () => {
    try {
      logger.info('Running periodic storage cleanup', {
        cleanupTypes: ['expired_cache_entries', 'old_stream_urls'],
        note: 'Favorites, images, and non-expired data are preserved',
      });
      await storageProvider.cleanup();
      logger.info('Periodic storage cleanup completed successfully');
    } catch (error) {
      logger.error('Error during scheduled cleanup', { error: error.message });
    }
  }, cleanupInterval);
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

module.exports = app;
