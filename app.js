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
const UnifiedCache = require('./database/UnifiedCache');
const healthRoutes = require('./routes/health');

// Controllers
const cacheController = require('./controllers/cacheController');
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
const initializeCache = async () => {
  try {
    cache = new UnifiedCache();
    await cache.initializeDatabase();

    // Make cache available to health checks and controllers
    app.locals.cache = cache;

    logger.info('Database initialized successfully', {
      type: config.database.useCloudDb ? 'cloud' : 'local',
      environment: config.environment,
    });

    // Print database stats on startup
    await cache.printStats();
  } catch (error) {
    logger.error('Database initialization failed', {
      error: error.message,
      stack: config.isDevelopment ? error.stack : undefined,
    });
    logger.warn('Continuing without cache - some features may be limited');
    // Continue without cache - graceful degradation
  }
};

// Initialize cache on startup
initializeCache();

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

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));

// ===========================
// ROUTE DEFINITIONS
// ===========================

// Health check routes (before other routes)
app.use('/', healthRoutes);

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
// Note: Using /api/cache paths for backward compatibility
app.post('/api/cache/favorites', favoritesController.addFavorite);
app.get('/api/cache/favorites', favoritesController.getFavorites);
app.delete('/api/cache/favorites', favoritesController.removeFavorite);
app.get(
  '/api/favorites/:favoriteId/details',
  favoritesController.getFavoriteDetails
);
app.post(
  '/api/favorites/:favoriteId/details',
  favoritesController.storeFavoriteDetails
);
app.get(
  '/api/favorites/:favoriteId/screenshots',
  favoritesController.getFavoriteScreenshots
);
app.post(
  '/api/favorites/:favoriteId/screenshots',
  favoritesController.storeFavoriteScreenshots
);
app.post('/api/favorites/check', favoritesController.checkFavorite);
app.post('/api/favorites/entry', favoritesController.storeFavoriteEntry);

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
// Note: This catch-all route should be last to avoid conflicts
app.get('/api/:website/:query/:page?', torrentController.searchTorrents);

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
const server = app.listen(PORT, () => {
  logger.info('Server started', {
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
