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

// Controllers
const cacheController = require('../controllers/cacheController');
const favoritesController = require('../controllers/favoritesController');
const torrentController = require('../controllers/torrentController');
const imageController = require('../controllers/imageController');
const videoController = require('../controllers/videoController');
const proxyController = require('../controllers/proxyController');

const app = express();

// Initialize cache
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

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(corsMiddleware());

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Health check routes
app.use('/health', require('../routes/health'));

// --- CACHE ROUTES ---
app.get('/api/cache/stats', cacheController.getStats);
app.post('/api/cache/cover-image', cacheController.storeCoverImage);
app.get('/api/cache/cover-image/:torrentKey', cacheController.getCoverImage);
app.post(
  '/api/cache/cover-image/torrent',
  cacheController.getCoverImageForTorrent
);
app.put(
  '/api/cache/cover-image/favorite/:favoriteId',
  cacheController.updateFavoriteEntryCoverImage
);
app.put(
  '/api/cache/cover-image/torrent-details/:favoriteId/:source',
  cacheController.updateTorrentDetailsCoverImage
);
app.put(
  '/api/cache/cover-image/cached-link/:cachedLinkId',
  cacheController.updateCachedLinkCoverImage
);
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

// --- PROXY ROUTES ---
// Note: MUST be before the catch-all torrent search route
app.options('/api/proxy/*', proxyController.handleCorsOptions);
app.all('/api/proxy/real-debrid/*', proxyController.realDebridProxy);

// API routes
app.get('/api/torrents', torrentController.getTorrentWebsites);

// --- MAIN SEARCH ROUTE ---
// Note: This catch-all route should be last to avoid conflicts
app.get('/api/:website/:query/:page?', torrentController.searchTorrents);

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
      cachedLinks: '/api/cache/cached-links',
      health: '/health',
    },
  });
});

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Export for Vercel
module.exports = app;
