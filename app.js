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

const initializeCache = async () => {
  try {
    logger.info('Starting cache initialization...');
    cache = new UnifiedCache();
    await cache.initializeDatabase();

    // Make cache available to health checks and controllers
    app.locals.cache = cache;

    logger.info('Cache instance created, initializing auth middleware...');
    // Initialize auth middleware now that cache is ready
    authMiddleware = new AuthMiddleware(cache);

    logger.info('Database initialized successfully', {
      type: config.database.useCloudDb ? 'cloud' : 'local',
      environment: config.environment,
    });

    // Print database stats on startup
    logger.info('Printing database stats...');
    await cache.printStats();
    logger.info('Database stats printed successfully');

    // Initialize auth routes now that cache is ready
    logger.info('About to call initializeAuthRoutes...');
    initializeAuthRoutes();
    logger.info('initializeAuthRoutes call completed');
    logger.info('Auth routes initialization completed');
  } catch (error) {
    logger.error('Database initialization failed', {
      error: error.message,
      stack: config.isDevelopment ? error.stack : undefined,
    });
    logger.warn('Continuing without cache - some features may be limited');
    // Continue without cache - graceful degradation
    initializeAuthRoutes();
  }
};

// Skip cache initialization for testing
console.log('app.js: Skipping cache initialization for testing...');
// initializeCache();

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

// Auth routes (must be before catch-all routes)
// Note: Auth routes need cache to be initialized, so they're set up after cache init
const initializeAuthRoutes = () => {
  logger.info('initializeAuthRoutes called', { cacheAvailable: !!cache });

  if (cache) {
    try {
      logger.info('Setting up auth routes with cache...');

      // Test with a minimal router first
      const express = require('express');
      const testRouter = express.Router();
      testRouter.get('/test', (req, res) => {
        res.json({ message: 'Test route works' });
      });

      logger.info('Test router created, registering with Express...');
      app.use('/api/auth-test', testRouter);
      logger.info('Test router registered successfully');

      // Test with minimal auth router first
      logger.info('Creating minimal auth router...');
      const minimalAuthRouter = express.Router();
      minimalAuthRouter.get('/google', (req, res) => {
        res.json({ message: 'Minimal Google auth route' });
      });
      logger.info('Minimal auth router created, registering...');
      app.use('/api/auth-minimal', minimalAuthRouter);
      logger.info('Minimal auth router registered successfully');

      // Test with minimal auth routes (no passport)
      logger.info('Testing minimal auth routes without passport...');
      const setupMinimalAuthRoutes = require('./routes/auth-minimal');
      const minimalAuthRouter2 = setupMinimalAuthRoutes(cache);
      logger.info('Minimal auth router created successfully');
      app.use('/api/auth-minimal2', minimalAuthRouter2);
      logger.info('Minimal auth router 2 registered successfully');

      // Try async router setup to avoid blocking
      logger.info('About to call setupAuthRoutes...');
      setTimeout(() => {
        try {
          logger.info('Setting up auth router in timeout...');
          const authRouter = setupAuthRoutes(cache);
          logger.info('setupAuthRoutes returned, router object received');

          app.use('/api/auth', authRouter);
          logger.info('Auth routes registered successfully at /api/auth');
        } catch (error) {
          logger.error('Error in async auth setup:', error);
        }
      }, 0);

      logger.info('Async auth setup initiated, continuing...');
    } catch (error) {
      logger.error('Failed to initialize auth routes:', {
        error: error.message,
        stack: error.stack
      });
      logger.warn('Continuing without auth routes');
    }

    // Register the catch-all torrent search route AFTER auth routes to prevent conflicts
    app.get('/api/:website/:query/:page?', torrentController.searchTorrents);
    logger.info('Torrent search route registered after auth routes');
  } else {
    logger.warn('Auth routes not initialized - cache not available');
    // Still register torrent route even if auth is not available
    app.get('/api/:website/:query/:page?', torrentController.searchTorrents);
    logger.info('Torrent search route registered (auth not available)');
  }
};

// --- CACHE ROUTES ---
app.get('/api/cache/stats', cacheController.getStats);
app.post('/api/cache/cover-image', cacheController.storeCoverImage);
app.get('/api/cache/cover-image/:torrentKey', cacheController.getCoverImage);
app.post('/api/cache/stream-url', cacheController.storeStreamUrl);
app.get('/api/cache/stream-url/:magnetHash', cacheController.getStreamUrl);
app.post('/api/cache/cached-links', cacheController.addCachedLink);
app.get('/api/cache/cached-links', cacheController.getCachedLinks);
app.delete('/api/cache/cached-links/:id', cacheController.removeCachedLink);
app.put('/api/cache/cached-links/:id', cacheController.updateCachedLink);
app.post('/api/cache/set', cacheController.setCacheValue);
app.get('/api/cache/get/:key', cacheController.getCacheValue);
app.delete('/api/cache/delete/:key', cacheController.deleteCacheValue);

// --- FAVORITES ROUTES ---
// Note: Using optional auth to support both authenticated and guest users
// When authenticated, favorites are user-specific. When not authenticated, returns empty results.
const getOptionalAuth = () =>
  authMiddleware ? authMiddleware.optionalAuth() : (req, res, next) => next();

app.post(
  '/api/cache/favorites',
  getOptionalAuth(),
  favoritesController.addFavorite
);
app.get(
  '/api/cache/favorites',
  getOptionalAuth(),
  favoritesController.getFavorites
);
app.delete(
  '/api/cache/favorites',
  getOptionalAuth(),
  favoritesController.removeFavorite
);
app.get(
  '/api/favorites/:favoriteId/details',
  getOptionalAuth(),
  favoritesController.getFavoriteDetails
);
app.post(
  '/api/favorites/:favoriteId/details',
  getOptionalAuth(),
  favoritesController.storeFavoriteDetails
);
app.get(
  '/api/favorites/:favoriteId/screenshots',
  getOptionalAuth(),
  favoritesController.getFavoriteScreenshots
);
app.post(
  '/api/favorites/:favoriteId/screenshots',
  getOptionalAuth(),
  favoritesController.storeFavoriteScreenshots
);
app.post(
  '/api/favorites/check',
  getOptionalAuth(),
  favoritesController.checkFavorite
);
app.post(
  '/api/favorites/entry',
  getOptionalAuth(),
  favoritesController.storeFavoriteEntry
);

// --- STORAGE ROUTES ---
// Frontend calls /api/storage/favorites instead of /api/cache/favorites
app.post(
  '/api/storage/favorites',
  getOptionalAuth(),
  favoritesController.addFavorite
);
app.get(
  '/api/storage/favorites',
  getOptionalAuth(),
  favoritesController.getFavorites
);
app.delete(
  '/api/storage/favorites',
  getOptionalAuth(),
  favoritesController.removeFavorite
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

// ===========================
// ERROR HANDLING MIDDLEWARE
// ===========================

app.use(notFoundHandler);
app.use(errorHandler);

// ===========================
// SERVER STARTUP
// ===========================

const PORT = process.env.PORT || 3001;
logger.info('Starting server...', { port: PORT });
const server = app.listen(PORT, () => {
  logger.info('Server started successfully', {
    port: PORT,
    environment: config.environment,
    nodeEnv: process.env.NODE_ENV,
  });
});

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
