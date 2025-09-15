// Vercel serverless function entry point
// This file adapts the Express app for Vercel's serverless environment

const path = require('path');

// Adjust require paths to go up one level since we're now in /api/
const { config, validateEnvironment } = require('../config/environment');
const logger = require('../middleware/logger');
const { corsMiddleware, validateCorsConfig } = require('../middleware/cors');
const {
  errorHandler,
  notFoundHandler,
  asyncHandler,
} = require('../middleware/errorHandler');

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

const express = require('express');
const combo = require('../torrent/COMBO.js');
const UnifiedCache = require('../database/UnifiedCache');
const googleImagesService = require('../services/googleImagesService');
const setupAuthRoutes = require('../routes/auth');
const AuthMiddleware = require('../middleware/auth');

// Controllers
const storageController = require('../controllers/storageController');
const favoritesController = require('../controllers/favoritesController');
const torrentController = require('../controllers/torrentController');
const imageController = require('../controllers/imageController');
const videoController = require('../controllers/videoController');
const proxyController = require('../controllers/proxyController');

const app = express();

// Initialize cache
let cache = null;
let authMiddleware = null;

// Auth routes initialization function
const initializeAuthRoutes = () => {
  console.log('API initializeAuthRoutes called', { cacheAvailable: !!cache });

  if (cache) {
    try {
      console.log('API: Setting up auth routes with cache...');
      const authRouter = setupAuthRoutes(cache);
      console.log('API: Auth router created, registering with Express...');

      app.use('/api/auth', authRouter);
      console.log('API: Auth routes registered successfully at /api/auth');
    } catch (error) {
      console.error('API: Failed to initialize auth routes:', error);
      console.warn('API: Continuing without auth routes');
    }
  } else {
    console.warn('API: Auth routes not initialized - cache not available');
  }
};

const initializeCache = async () => {
  try {
    console.log('API: Starting cache initialization...');
    cache = new UnifiedCache();

    // Skip database initialization for now to avoid hang
    console.log('API: Skipping database initialization temporarily');

    // Make cache available to health checks and controllers (even if not fully initialized)
    app.locals.cache = cache;

    console.log('API: Cache instance created, initializing auth middleware...');
    // Initialize auth middleware with cache instance
    authMiddleware = new AuthMiddleware(cache);

    console.log('API: Cache setup completed (DB initialization skipped)');

    // Initialize auth routes now that cache instance is ready
    console.log('API: About to call initializeAuthRoutes...');
    initializeAuthRoutes();
    console.log('API: initializeAuthRoutes call completed');
  } catch (error) {
    logger.error('Cache initialization failed', {
      error: error.message,
      stack: config.isDevelopment ? error.stack : undefined,
    });
    logger.warn('Continuing without cache - some features may be limited');
    // Continue without cache - graceful degradation
    initializeAuthRoutes();
  }
};

// Initialize cache on startup
console.log('API: About to call initializeCache...');
initializeCache();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(corsMiddleware());

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Health check routes
app.use('/health', require('../routes/health'));

// --- STORAGE ROUTES (Turso Database) ---
app.get('/api/storage/stats', storageController.getStats);
app.post('/api/storage/cover-image', storageController.storeCoverImage);
app.get(
  '/api/storage/cover-image/:torrentKey',
  storageController.getCoverImage
);
app.post(
  '/api/storage/cover-image/torrent',
  storageController.getCoverImageForTorrent
);
app.put(
  '/api/storage/cover-image/favorite/:favoriteId',
  storageController.updateFavoriteEntryCoverImage
);
app.put(
  '/api/storage/cover-image/torrent-details/:favoriteId/:source',
  storageController.updateTorrentDetailsCoverImage
);
// Temporarily disabled due to undefined method error
// app.put(
//   '/api/storage/cover-image/stored-link/:storedLinkId',
//   storageController.updateCachedLinkCoverImage
// );
app.post('/api/storage/stream-url', storageController.storeStreamUrl);
app.get('/api/storage/stream-url/:magnetHash', storageController.getStreamUrl);
app.post('/api/storage/stored-links', storageController.addCachedLink);
app.get('/api/storage/stored-links', storageController.getCachedLinks);
app.delete('/api/storage/stored-links/:id', storageController.removeCachedLink);
app.put('/api/storage/stored-links/:id', storageController.updateCachedLink);
app.post('/api/storage/set', storageController.setCacheValue);
app.get('/api/storage/get/:key', storageController.getCacheValue);
app.delete('/api/storage/delete/:key', storageController.deleteCacheValue);

// --- FAVORITES ROUTES ---
// Note: Using optional auth to support both authenticated and guest users
// When authenticated, favorites are user-specific. When not authenticated, returns empty results.
const getOptionalAuth = () =>
  authMiddleware ? authMiddleware.optionalAuth() : (req, res, next) => next();

// Note: Using /api/storage paths for database operations
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

// Maintain backward compatibility for existing clients
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

// --- PROXY ROUTES ---
// Note: MUST be before the catch-all torrent search route
app.options('/api/proxy/*', proxyController.handleCorsOptions);
app.all('/api/proxy/real-debrid/*', proxyController.realDebridProxy);

// API routes
app.get('/api/torrents', torrentController.getTorrentWebsites);

// --- MAIN SEARCH ROUTE ---
// Note: Temporarily disabled to test auth routes - this conflicts with /api/auth/*
// app.get('/api/:website/:query/:page?', torrentController.searchTorrents);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Torrent Search API',
    version: '1.0.0',
    endpoints: {
      torrents: '/api/torrents',
      search: '/api/{website}/{query}/{page?}',
      favorites: '/api/cache/favorites',
      favoriteCheck: '/api/favorites/check',
      googleImages: '/api/google-images/search',
      storedLinks: '/api/storage/stored-links',
      cachedLinks: '/api/cache/cached-links', // deprecated, use storedLinks
      health: '/health',
    },
  });
});

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Export for Vercel
module.exports = app;
