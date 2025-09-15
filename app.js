// ===========================
// IMPORTS AND ENVIRONMENT SETUP
// ===========================

console.log('app.js: Starting application initialization...');

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
const UnifiedCache = require('./database/UnifiedCache');
const healthRoutes = require('./routes/health');
const setupAuthRoutes = require('./routes/auth');
const AuthMiddleware = require('./middleware/auth');

// Controllers
const cacheController = require('./controllers/storageController');
const favoritesController = require('./controllers/favoritesController');
const torrentController = require('./controllers/torrentController');
const imageController = require('./controllers/imageController');
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

// Initialize unified cache (supports both local SQLite and Turso cloud)
let cache = null;
let authMiddleware = null;

// Database initialization can be added later if needed
console.log('app.js: Cache and auth setup completed during startup');

// ===========================
// MIDDLEWARE SETUP
// ===========================

console.log('app.js: Setting up middleware...');

// Request logging middleware
app.use(logger.requestMiddleware());
console.log('app.js: Logger middleware added');

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
console.log('app.js: Body parsing middleware added');

// CORS middleware with environment-specific configuration
app.use(corsMiddleware());
console.log('app.js: CORS middleware added');

// Initialize passport middleware
app.use(passport.initialize());
console.log('app.js: Passport middleware added');

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));
console.log('app.js: Static file middleware added');

// ===========================
// ROUTE DEFINITIONS
// ===========================

console.log('app.js: Setting up routes...');

// Health check routes (before other routes)
app.use('/', healthRoutes);
console.log('app.js: Health routes added');

// Initialize a minimal cache for auth routes during startup
console.log('app.js: Setting up minimal cache for auth routes...');
// Note: Server startup will happen after async initialization completes

// --- CACHE ROUTES ---
console.log('app.js: Setting up cache routes...');
app.get('/api/cache/stats', cacheController.getStats);
app.post('/api/cache/cover-image', cacheController.storeCoverImage);
app.get('/api/cache/cover-image/:torrentKey', cacheController.getCoverImage);
app.post('/api/cache/stream-url', cacheController.storeStreamUrl);
app.get('/api/cache/stream-url/:magnetHash', cacheController.getStreamUrl);
// Note: Cached links routes moved to startServer() for proper auth middleware
app.post('/api/cache/set', cacheController.setCacheValue);
app.get('/api/cache/get/:key', cacheController.getCacheValue);
app.delete('/api/cache/delete/:key', cacheController.deleteCacheValue);
console.log('app.js: Cache routes added');

// --- FAVORITES ROUTES ---
// Note: These will be registered after authMiddleware is initialized in startServer()
console.log(
  'app.js: Favorites routes will be registered after authMiddleware initialization'
);

// --- IMAGE ROUTES ---
app.get('/api/google-images/search', imageController.searchGoogleImages);
app.get(
  '/api/google-images/suggestions',
  imageController.getGoogleImagesSuggestions
);
app.post('/api/pixhost/upload', imageController.uploadToPixhost);
app.get('/api/proxy/image', imageController.proxyImage);
app.post('/api/images/batch-process', imageController.batchProcessImages);

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
// Note: More specific routes first to avoid conflicts
app.get(
  '/api/torrent-details/:website/:torrentUrl',
  torrentController.getTorrentDetails
);
app.get('/api/torrents', torrentController.getTorrentWebsites);

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
    // Initialize cache and database first with timeout
    console.log('app.js: Initializing cache and database...');
    cache = new UnifiedCache();

    // Add timeout to database initialization
    const initPromise = cache.initializeDatabase();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Database initialization timeout')),
        30000
      )
    );

    await Promise.race([initPromise, timeoutPromise]);
    app.locals.cache = cache;
    console.log('app.js: Cache instance created and database initialized');

    // Initialize auth middleware
    authMiddleware = new AuthMiddleware(cache);
    console.log('app.js: AuthMiddleware created with cache');

    // Register auth routes
    console.log('app.js: Registering auth routes...');
    const setupAuthRoutes = require('./routes/auth');
    const authRouter = setupAuthRoutes(cache);
    app.use('/api/auth', authRouter);
    console.log('app.js: Auth routes registered successfully at /api/auth');

    // Now register favorites routes with proper auth middleware
    console.log('app.js: Setting up favorites routes with auth...');

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

    console.log('app.js: Favorites routes registered successfully');

    // --- STORAGE ROUTES FOR CACHED LINKS ---
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

    console.log('app.js: Storage routes registered successfully');

    // --- REGISTER TORRENT SEARCH ROUTE AFTER AUTH ROUTES ---
    app.get('/api/:website/:query/:page?', torrentController.searchTorrents);
    console.log('app.js: Torrent search route registered after auth routes');

    // Add error handling middleware after all routes are registered
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Now start the server
    console.log('app.js: About to start server...');
    const PORT = process.env.PORT || 3001;
    console.log('app.js: Starting server on port:', PORT);
    const server = app.listen(PORT, () => {
      console.log('app.js: Server started successfully on port:', PORT);
    });

    return server;
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    console.log('app.js: Starting server without full database initialization');

    // Initialize minimal cache without database
    cache = new UnifiedCache();
    app.locals.cache = cache;
    console.log(
      'app.js: Created cache instance without database initialization'
    );

    // Initialize auth middleware (will handle database unavailability gracefully)
    authMiddleware = new AuthMiddleware(cache);
    console.log('app.js: AuthMiddleware created with minimal cache');

    // Register auth routes with minimal setup
    console.log('app.js: Registering auth routes with minimal setup...');
    const setupAuthRoutes = require('./routes/auth');
    const authRouter = setupAuthRoutes(cache);
    app.use('/api/auth', authRouter);
    console.log('app.js: Auth routes registered in fallback mode');

    // Register favorites routes (with fallback auth middleware)
    console.log('app.js: Setting up favorites routes with fallback auth...');

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

    console.log('app.js: Favorites routes registered with fallback auth');

    // --- STORAGE ROUTES FOR CACHED LINKS (FALLBACK) ---
    app.post(
      '/api/storage/stored-links',
      (req, res, next) => {
        console.log(
          '🔍 [Routes] POST /api/storage/stored-links called (fallback)'
        );
        console.log(
          '🔍 [Routes] Headers:',
          req.headers.authorization ? 'Has Authorization' : 'No Authorization'
        );
        next();
      },
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
    app.post('/api/storage/set', cacheController.setCacheValue);
    app.get('/api/storage/get/:key', cacheController.getCacheValue);
    app.delete('/api/storage/delete/:key', cacheController.deleteCacheValue);

    console.log('app.js: Storage routes registered in fallback mode');

    // --- REGISTER TORRENT SEARCH ROUTE AFTER AUTH ROUTES (FALLBACK) ---
    app.get('/api/:website/:query/:page?', torrentController.searchTorrents);
    console.log('app.js: Torrent search route registered in fallback mode');

    // Add error handling middleware after all routes are registered
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Start server
    const PORT = process.env.PORT || 3001;
    const server = app.listen(PORT, () => {
      console.log('app.js: Server started in fallback mode on port:', PORT);
    });

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

    if (cache) {
      try {
        await cache.cleanup();
        await cache.close();
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

// Periodic cache cleanup handler
const startPeriodicCacheCleanup = () => {
  if (!cache) {
    logger.warn('Cache not available - skipping periodic cleanup');
    return;
  }

  const cleanupInterval = 60 * 60 * 1000; // 1 hour
  logger.info('Starting periodic cache cleanup', {
    intervalMinutes: cleanupInterval / (60 * 1000),
    cleanupScope:
      'Expired cache entries and old stream URLs (keeps 100 most recent)',
  });

  setInterval(async () => {
    try {
      logger.info('Running periodic cache cleanup', {
        cleanupTypes: ['expired_cache_entries', 'old_stream_urls'],
        note: 'Favorites, images, and non-expired data are preserved',
      });
      await cache.cleanup();
      logger.info('Periodic cache cleanup completed successfully');
    } catch (error) {
      logger.error('Error during scheduled cleanup', { error: error.message });
    }
  }, cleanupInterval);
};

// Initialize periodic cleanup
startPeriodicCacheCleanup();

module.exports = app;
