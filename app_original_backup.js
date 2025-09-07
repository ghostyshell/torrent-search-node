// Load environment configuration
const { config, validateEnvironment } = require('./config/environment');
const logger = require('./middleware/logger');
const { corsMiddleware, validateCorsConfig } = require('./middleware/cors');
const {
  errorHandler,
  notFoundHandler,
  asyncHandler,
} = require('./middleware/errorHandler');

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
const combo = require('./torrent/COMBO');
const path = require('path');
const UnifiedCache = require('./database/UnifiedCache');
const googleImagesService = require('./services/googleImagesService');
const healthRoutes = require('./routes/health');

// Import torrent modules directly
const limeTorrent = require('./torrent/limeTorrent');
const nyaaSI = require('./torrent/nyaaSI');
const pirateBay = require('./torrent/pirateBay');
const torrentProject = require('./torrent/torrentProject');
const yts = require('./torrent/yts');

// Create torrents object
const torrents = {
  limetorrent: limeTorrent,
  nyaasi: nyaaSI,
  piratebay: pirateBay,
  torrentproject: torrentProject,
  yts: yts,
};

const app = express();

// Trust proxy in production
if (config.security.trustProxy) {
  app.set('trust proxy', 1);
}

// Initialize unified cache (supports both local SQLite and Turso cloud)
let cache = null;
const initializeCache = async () => {
  try {
    cache = new UnifiedCache();
    await cache.initializeDatabase();

    // Make cache available to health checks
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

// Request logging middleware
app.use(logger.requestMiddleware());

// Middleware for parsing JSON bodies
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Enhanced CORS middleware with environment-specific configuration
app.use(corsMiddleware());

app.use(express.static(path.join(__dirname, 'public')));

// Health check routes (before other routes)
app.use('/', healthRoutes);

// === CACHE API ENDPOINTS ===

// Get cache statistics
app.get('/api/cache/stats', async (req, res) => {
  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const stats = await cache.getStats();
    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cache statistics',
      message: error.message,
    });
  }
});

// Clear all caches
app.post('/api/cache/clear', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    await cache.clearAll();
    res.json({
      success: true,
      message: 'All caches cleared successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clear caches',
      message: error.message,
    });
  }
});

// Store cover image
app.post('/api/cache/cover-image', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { torrent, imageUrl, imageData } = req.body;

    if (!torrent || !imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: torrent, imageUrl',
      });
    }

    // Convert base64 image data to buffer if provided
    let imageBuffer = null;
    if (imageData) {
      // Validate that imageData looks like valid image data
      if (typeof imageData === 'object' && imageData.error) {
        // This is an error response, not image data
        logger.warn('Attempted to store error response as image data', {
          torrent: torrent.Name?.substring(0, 50),
          error: imageData.error?.substring(0, 100),
        });
        return res.status(400).json({
          success: false,
          error: 'Invalid image data: error response received instead of image',
        });
      }

      if (typeof imageData !== 'string' || imageData.length < 100) {
        // Image data should be a long base64 string
        return res.status(400).json({
          success: false,
          error: 'Invalid image data: data too short or wrong format',
        });
      }

      const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');

      // Additional validation: check if the buffer looks like image data
      if (imageBuffer.length < 100) {
        return res.status(400).json({
          success: false,
          error: 'Invalid image data: decoded buffer too small',
        });
      }
    }

    const success = await cache.setCoverImage(torrent, imageUrl, imageBuffer);

    if (success) {
      res.json({
        success: true,
        message: 'Cover image cached successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to cache cover image',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cache cover image',
      message: error.message,
    });
  }
});

// Get cover image
app.get('/api/cache/cover-image/:torrentKey', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const torrentKey = req.params.torrentKey;

    // Try direct database query for blob storage first (most reliable)
    try {
      const blobSql = `
        SELECT image_data, mime_type, original_url FROM images 
        WHERE torrent_key = ? AND image_type = 'cover'
      `;

      const row = await cache.dbManager.get(blobSql, [torrentKey]);

      if (row) {
        // Validate that the data is actually binary image data, not JSON
        let imageData = row.image_data;

        // If it's an object (JSON), it's not valid image data
        if (typeof imageData === 'object' && imageData !== null) {
          logger.warn(
            'Invalid image data found in database (JSON object instead of binary)',
            {
              torrentKey: torrentKey?.substring(0, 50),
              dataType: typeof imageData,
            }
          );
          // Skip to next fallback
        } else if (
          Buffer.isBuffer(imageData) ||
          (typeof imageData === 'string' && imageData.length > 0)
        ) {
          // Return blob data directly
          res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
          res.send(imageData);
          return;
        }
      }
    } catch (blobError) {
      logger.warn('Direct blob query failed:', blobError.message);
    }

    // Fallback: Try URL cache with the key
    try {
      const urlData = await cache.get(`cover_url_${torrentKey}`);
      if (urlData && urlData.imageUrl) {
        // Fetch the image from the URL and serve it directly
        try {
          const fetch = require('node-fetch');
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

          const imageResponse = await fetch(urlData.imageUrl, {
            headers: {
              'User-Agent': 'TorrentSearchBot/1.0',
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (imageResponse.ok) {
            const contentType = imageResponse.headers.get('content-type');
            if (contentType && contentType.startsWith('image/')) {
              res.setHeader('Content-Type', contentType);
              res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
              imageResponse.body.pipe(res);
              return;
            }
          }
        } catch (fetchError) {
          logger.warn('Failed to fetch image from URL cache:', {
            error: fetchError.message,
            imageUrl: urlData.imageUrl?.substring(0, 100),
          });
          // Continue to next fallback
        }
      }
    } catch (urlError) {
      logger.warn('URL cache query failed:', urlError.message);
    }

    // Final fallback: Use the original method with simplified torrent object
    const torrent = { Name: torrentKey };
    const imageData = await cache.getCoverImage(torrent);

    if (imageData) {
      if (imageData.type === 'blob') {
        res.setHeader('Content-Type', imageData.mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
        res.send(imageData.data);
      } else if (imageData.imageUrl) {
        // Fetch the image from the URL and serve it directly
        try {
          const fetch = require('node-fetch');
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

          const imageResponse = await fetch(imageData.imageUrl, {
            headers: {
              'User-Agent': 'TorrentSearchBot/1.0',
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (imageResponse.ok) {
            const contentType = imageResponse.headers.get('content-type');
            if (contentType && contentType.startsWith('image/')) {
              res.setHeader('Content-Type', contentType);
              res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
              imageResponse.body.pipe(res);
              return;
            }
          }

          // If fetch failed, return 404
          res.status(404).json({
            success: false,
            error: 'Cover image not found or invalid',
          });
        } catch (fetchError) {
          logger.warn('Failed to fetch image in final fallback:', {
            error: fetchError.message,
            imageUrl: imageData.imageUrl?.substring(0, 100),
          });
          res.status(404).json({
            success: false,
            error: 'Cover image not found',
          });
        }
      } else {
        res.status(404).json({
          success: false,
          error: 'Cover image not found',
        });
      }
    } else {
      res.status(404).json({
        success: false,
        error: 'Cover image not found',
      });
    }
  } catch (error) {
    logger.error('Cover image retrieval error:', {
      error: error.message,
      torrentKey: req.params.torrentKey?.substring(0, 50),
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get cover image',
      message: error.message,
    });
  }
});

// Store stream URL
app.post('/api/cache/stream-url', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { magnetLink, streamData } = req.body;

    if (!magnetLink || !streamData || !streamData.streamUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: magnetLink, streamData.streamUrl',
      });
    }

    const success = await cache.setStreamUrl(magnetLink, streamData);

    if (success) {
      res.json({
        success: true,
        message: 'Stream URL cached successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to cache stream URL',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cache stream URL',
      message: error.message,
    });
  }
});

// Get stream URL
app.get('/api/cache/stream-url/:magnetHash', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const magnetHash = req.params.magnetHash; // This is just the hash now
    const streamData = await cache.getStreamUrlByHash(magnetHash);

    if (streamData) {
      res.json({
        success: true,
        ...streamData,
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Stream URL not found',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get stream URL',
      message: error.message,
    });
  }
});

// Add favorite (New Entry-Based System)
app.post('/api/cache/favorites', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { torrent } = req.body;

    if (!torrent) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: torrent',
      });
    }

    // Check if favorite entry already exists
    let favoriteEntry = await cache.getFavoriteEntry(torrent);

    if (!favoriteEntry) {
      // Create new favorite entry
      const favoriteId = await cache.createFavoriteEntry(torrent);
      if (favoriteId) {
        favoriteEntry = await cache.getFavoriteEntryById(favoriteId);
      }
    }

    if (favoriteEntry) {
      // Also maintain backward compatibility with old favorites table
      await cache.addFavorite(torrent);

      res.json({
        success: true,
        message: 'Favorite added successfully',
        favoriteEntry: favoriteEntry,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to create favorite entry',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to add favorite',
      message: error.message,
    });
  }
});

// Get favorites (New Entry-Based System)
app.get('/api/cache/favorites', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20; // Default 20 items per page
    const offset = (page - 1) * limit;

    // Use optimized database-level pagination and merging
    const [favorites, totalCount] = await Promise.all([
      cache.getMergedFavoritesPaginated(limit, offset),
      cache.getMergedFavoritesCount(),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      favorites,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get favorites',
      message: error.message,
    });
  }
});

// Remove favorite (New Entry-Based System)
app.delete('/api/cache/favorites', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { torrent, favoriteEntryId } = req.body;

    if (!torrent && !favoriteEntryId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: torrent or favoriteEntryId',
      });
    }

    let success = false;

    if (favoriteEntryId) {
      // Remove by favorite entry ID (new system)
      success = await cache.removeFavoriteEntry(favoriteEntryId);
    } else if (torrent) {
      // Remove by torrent data (backward compatibility)
      // First try to find and remove from new system
      const favoriteEntry = await cache.getFavoriteEntry(torrent);
      if (favoriteEntry) {
        success = await cache.removeFavoriteEntry(favoriteEntry.id);
      }

      // Also remove from old system for backward compatibility
      await cache.removeFavorite(torrent);
      success = true; // Consider it successful if we processed the torrent
    }

    if (success) {
      res.json({
        success: true,
        message: 'Favorite removed successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Favorite not found',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to remove favorite',
      message: error.message,
    });
  }
});

// === CACHED LINKS API ENDPOINTS ===

// Add cached link
app.post('/api/cache/cached-links', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const {
      url,
      title,
      streamUrl,
      streamUrlCachedAt,
      isStreaming,
      error,
      supportsRangeRequests,
      filename,
    } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: url',
      });
    }

    const cachedLink = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      url,
      title: title || extractTitleFromUrl(url),
      dateAdded: new Date().toISOString(),
      // Include stream URL fields for proper syncing
      streamUrl: streamUrl || undefined,
      streamUrlCachedAt: streamUrlCachedAt || undefined,
      isStreaming: isStreaming || undefined,
      error: error || undefined,
      supportsRangeRequests: supportsRangeRequests || undefined,
      filename: filename || undefined,
    };

    const success = await cache.addCachedLink(cachedLink);

    if (success) {
      res.json({
        success: true,
        message: 'Link cached successfully',
        cachedLink,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to cache link',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cache link',
      message: error.message,
    });
  }
});

// Get cached links
app.get('/api/cache/cached-links', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    // Validate parameters
    const validPage = Math.max(1, page);
    const validLimit = Math.max(1, Math.min(100, limit)); // Cap at 100

    const result = await cache.getCachedLinks(validPage, validLimit);
    res.json({
      success: true,
      ...result, // cachedLinks and pagination
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cached links',
      message: error.message,
    });
  }
});

// Remove cached link
app.delete('/api/cache/cached-links/:id', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: id',
      });
    }

    const success = await cache.removeCachedLink(id);

    if (success) {
      res.json({
        success: true,
        message: 'Cached link removed successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Cached link not found',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to remove cached link',
      message: error.message,
    });
  }
});

// Update cached link
app.put('/api/cache/cached-links/:id', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { id } = req.params;
    const updates = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: id',
      });
    }

    const success = await cache.updateCachedLink(id, updates);

    if (success) {
      res.json({
        success: true,
        message: 'Cached link updated successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Cached link not found',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update cached link',
      message: error.message,
    });
  }
});

// Helper function to extract title from URL
function extractTitleFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    const path = urlObj.pathname;

    if (path && path !== '/') {
      const pathParts = path.split('/').filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart) {
        return `${hostname}/${lastPart}`;
      }
    }

    return hostname;
  } catch {
    return 'Cached Link';
  }
}

// === FAVORITE ENTRIES API ENDPOINTS (New System) ===

// Get torrent details for a favorite entry
app.get('/api/favorites/:favoriteId/details', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { favoriteId } = req.params;
    const { source } = req.query;

    const details = await cache.getTorrentDetails(favoriteId, source);

    res.json({
      success: true,
      details: source ? details : details, // Return single object or array
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get torrent details',
      message: error.message,
    });
  }
});

// Set torrent details for a favorite entry
app.post('/api/favorites/:favoriteId/details', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { favoriteId } = req.params;
    const { source, detailsData } = req.body;

    if (!source || !detailsData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: source, detailsData',
      });
    }

    const success = await cache.setTorrentDetails(
      favoriteId,
      source,
      detailsData
    );

    if (success) {
      res.json({
        success: true,
        message: 'Torrent details saved successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to save torrent details',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to save torrent details',
      message: error.message,
    });
  }
});

// Get screenshots for a favorite entry
app.get('/api/favorites/:favoriteId/screenshots', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { favoriteId } = req.params;

    const screenshots = await cache.getFavoriteScreenshots(favoriteId);

    res.json({
      success: true,
      screenshots,
      count: screenshots.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get screenshots',
      message: error.message,
    });
  }
});

// Add screenshot to a favorite entry
app.post('/api/favorites/:favoriteId/screenshots', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { favoriteId } = req.params;
    const { screenshotData } = req.body;

    if (!screenshotData || typeof screenshotData.timestamp !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: screenshotData with timestamp',
      });
    }

    const success = await cache.addFavoriteScreenshot(
      favoriteId,
      screenshotData
    );

    if (success) {
      res.json({
        success: true,
        message: 'Screenshot saved successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to save screenshot',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to save screenshot',
      message: error.message,
    });
  }
});

// Get favorite entry by torrent data
// Check if torrent is a favorite (read-only, efficient)
app.post('/api/favorites/check', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { torrent } = req.body;

    if (!torrent) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: torrent',
      });
    }

    const torrentKey = cache.generateTorrentKey(torrent);
    const favoriteEntry = await cache.getFavoriteEntryByKey(torrentKey);

    res.json({
      success: true,
      isFavorite: favoriteEntry !== null,
      favoriteEntry: favoriteEntry || undefined,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to check favorite status',
      message: error.message,
    });
  }
});

app.post('/api/favorites/entry', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { torrent } = req.body;

    if (!torrent) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: torrent',
      });
    }

    const favoriteEntry = await cache.getOrCreateFavoriteEntry(torrent);

    res.json({
      success: true,
      favoriteEntry,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get or create favorite entry',
      message: error.message,
    });
  }
});

// === END CACHE API ENDPOINTS ===

// New endpoint for torrent details (must come before the general search route)
app.get('/api/torrent-details/:website/:torrentUrl', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  const website = req.params.website.toLowerCase();
  const torrentUrl = decodeURIComponent(req.params.torrentUrl);

  if (
    website === 'piratebay' &&
    torrents[website] &&
    torrents[website].getDetails
  ) {
    torrents[website]
      .getDetails(torrentUrl)
      .then((details) => {
        res.json(details);
      })
      .catch((error) => {
        res.status(500).json({
          error: 'Failed to fetch torrent details',
          message: error.message,
        });
      });
  } else {
    res.status(404).json({
      error: `Torrent details not supported for "${website}" or website not found`,
      debug: {
        website,
        hasModule: !!torrents[website],
        hasGetDetails: !!(torrents[website] && torrents[website].getDetails),
      },
    });
  }
});

// Google Images search endpoint
app.get('/api/google-images/search', async (req, res) => {
  try {
    const { q: query, limit = 20 } = req.query;

    if (!query) {
      return res.status(400).json({
        error: 'Query parameter "q" is required',
      });
    }

    const results = await googleImagesService.searchImages(
      query,
      parseInt(limit)
    );

    res.json({
      success: true,
      query: query,
      results: results,
      count: results.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Google Images search suggestions endpoint
app.get('/api/google-images/suggestions', (req, res) => {
  try {
    const { q: query } = req.query;

    if (!query) {
      return res.status(400).json({
        error: 'Query parameter "q" is required',
      });
    }

    const suggestions = googleImagesService.generateSearchSuggestions(query);

    res.json({
      success: true,
      query: query,
      suggestions: suggestions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Pixhost image upload proxy endpoint
app.post('/api/pixhost/upload', async (req, res) => {
  try {
    const { imageUrl, imageData } = req.body;

    if (!imageUrl && !imageData) {
      return res.status(400).json({
        success: false,
        error: 'Either imageUrl or imageData is required',
      });
    }

    const fetch = require('node-fetch');
    const FormData = require('form-data');

    let imageBuffer;

    if (imageData) {
      // Handle base64 encoded image data
      const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');

      // Check size limit (10MB max)
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB
      if (imageBuffer.length > MAX_SIZE) {
        throw new Error(
          `Image too large: ${(imageBuffer.length / 1024 / 1024).toFixed(
            1
          )}MB. Maximum size is ${MAX_SIZE / 1024 / 1024}MB.`
        );
      }
    } else {
      // Fetch image from URL
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }

      // Check content length if provided
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength);
        const MAX_SIZE = 10 * 1024 * 1024; // 10MB
        if (size > MAX_SIZE) {
          throw new Error(
            `Image too large: ${(size / 1024 / 1024).toFixed(
              1
            )}MB. Maximum size is ${MAX_SIZE / 1024 / 1024}MB.`
          );
        }
      }

      imageBuffer = await response.buffer();

      // Final size check after fetching
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB
      if (imageBuffer.length > MAX_SIZE) {
        throw new Error(
          `Image too large: ${(imageBuffer.length / 1024 / 1024).toFixed(
            1
          )}MB. Maximum size is ${MAX_SIZE / 1024 / 1024}MB.`
        );
      }
    }

    // Create form data for pixhost API
    const form = new FormData();
    form.append('img', imageBuffer, {
      filename: 'image.jpg',
      contentType: 'image/jpeg',
    });
    form.append('content_type', '0'); // 0 for SFW
    form.append('max_th_size', '420');

    // Upload to pixhost
    const pixhostResponse = await fetch('https://api.pixhost.to/images', {
      method: 'POST',
      body: form,
      headers: {
        Accept: 'application/json',
        ...form.getHeaders(),
      },
    });

    if (!pixhostResponse.ok) {
      const errorText = await pixhostResponse.text();

      // Provide more specific error messages
      let errorMessage = `Pixhost API error: ${pixhostResponse.status}`;

      if (pixhostResponse.status === 414) {
        errorMessage = `Pixhost API error: 414 - Image URL too long. The image URL exceeds Pixhost's maximum URL length limit.`;
      } else if (pixhostResponse.status === 413) {
        errorMessage = `Pixhost API error: 413 - Image file too large. Maximum file size exceeded.`;
      } else if (pixhostResponse.status === 400) {
        errorMessage = `Pixhost API error: 400 - Bad request. Invalid image format or corrupted image data.`;
      } else if (pixhostResponse.status === 429) {
        errorMessage = `Pixhost API error: 429 - Rate limit exceeded. Too many upload requests.`;
      } else if (errorText) {
        errorMessage += ` ${errorText}`;
      }

      throw new Error(errorMessage);
    }

    const result = await pixhostResponse.json();

    if (!result.show_url) {
      throw new Error('Invalid response from pixhost API');
    }

    // Convert show URL to direct image URL
    // https://pixhost.to/show/8325/636090636_image.jpg -> https://img1.pixhost.to/images/8325/636090636_image.jpg
    const directImageUrl = result.show_url.replace(
      'https://pixhost.to/show/',
      'https://img1.pixhost.to/images/'
    );

    res.json({
      success: true,
      originalUrl: imageUrl,
      pixhostUrl: directImageUrl,
      pixhostShowUrl: result.show_url, // Keep original show URL for reference
      thumbnailUrl: result.th_url,
    });
  } catch (error) {
    logger.error('Pixhost upload error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Video screenshot endpoint using ffmpeg
app.post(
  '/api/video/screenshot',
  asyncHandler(async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const { videoUrl, timestamp, magnetLink, filename } = req.body;

    if (!videoUrl || typeof timestamp !== 'number') {
      return res.status(400).json({
        success: false,
        error:
          'Missing required fields: videoUrl (string) and timestamp (number)',
      });
    }

    // Check if ffmpeg is available
    const { spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');

    try {
      // Create temp directory if it doesn't exist
      const tempDir = path.join(__dirname, 'tmp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilename = `screenshot_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}.jpg`;
      const tempPath = path.join(tempDir, tempFilename);

      logger.info('Generating video screenshot', {
        videoUrl: videoUrl.substring(0, 100) + '...',
        timestamp,
        tempPath,
      });

      // Use ffmpeg to capture screenshot
      const ffmpegArgs = [
        '-ss',
        timestamp.toString(), // Seek to timestamp
        '-i',
        videoUrl, // Input video URL
        '-vframes',
        '1', // Extract single frame
        '-q:v',
        '2', // High quality JPEG
        '-vf',
        'scale=1280:720:force_original_aspect_ratio=decrease', // Scale to max 720p maintaining aspect ratio
        '-y', // Overwrite output file
        tempPath, // Output path
      ];

      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
      let stderr = '';

      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpegProcess.on('close', async (code) => {
        if (code !== 0) {
          logger.error('FFmpeg process failed', {
            code,
            stderr: stderr.substring(0, 500),
          });

          // Clean up temp file if it exists
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }

          return res.status(500).json({
            success: false,
            error: 'Failed to generate screenshot',
            details: 'FFmpeg process failed',
          });
        }

        try {
          // Check if screenshot file was created
          if (!fs.existsSync(tempPath)) {
            return res.status(500).json({
              success: false,
              error: 'Screenshot file was not created',
            });
          }

          // Read the screenshot file
          const screenshotBuffer = fs.readFileSync(tempPath);
          const base64Screenshot = screenshotBuffer.toString('base64');

          // Get file stats
          const stats = fs.statSync(tempPath);
          const fileSizeKB = Math.round(stats.size / 1024);

          logger.info('Screenshot generated successfully', {
            filename: tempFilename,
            sizeKB: fileSizeKB,
            timestamp,
          });

          // Upload to pixhost for better hosting
          let pixhostUrl = null;
          try {
            const fetch = require('node-fetch');
            const FormData = require('form-data');

            const form = new FormData();
            form.append('img', screenshotBuffer, {
              filename: tempFilename,
              contentType: 'image/jpeg',
            });
            form.append('content_type', '0'); // 0 for SFW
            form.append('max_th_size', '420');

            const pixhostResponse = await fetch(
              'https://api.pixhost.to/images',
              {
                method: 'POST',
                body: form,
                headers: {
                  Accept: 'application/json',
                  ...form.getHeaders(),
                },
              }
            );

            if (pixhostResponse.ok) {
              const result = await pixhostResponse.json();
              if (result.show_url) {
                pixhostUrl = result.show_url.replace(
                  'https://pixhost.to/show/',
                  'https://img1.pixhost.to/images/'
                );
                logger.info('Screenshot uploaded to pixhost', { pixhostUrl });
              }
            } else {
              logger.warn('Pixhost upload failed', {
                status: pixhostResponse.status,
                statusText: pixhostResponse.statusText,
              });
            }
          } catch (pixhostError) {
            logger.warn('Error uploading to pixhost', {
              error: pixhostError.message,
            });
          }

          // Normalize timestamp for consistent cache keys
          const normalizedTimestamp = Number(timestamp.toFixed(6));

          // Cache screenshot if cache is available and magnetLink provided
          let cacheSuccess = false;
          let favoriteEntryUsed = false;
          if (cache && magnetLink) {
            try {
              const screenshotData = {
                base64: `data:image/jpeg;base64,${base64Screenshot}`,
                pixhostUrl: pixhostUrl,
                timestamp: normalizedTimestamp,
                filename: filename || tempFilename,
                generatedAt: new Date().toISOString(),
                videoUrl: videoUrl.substring(0, 100) + '...',
              };

              // First, check if this magnet link belongs to a favorite entry
              let favoriteEntry = null;
              try {
                // Try to find a favorite entry by checking all entries and their magnet links
                const allFavorites = await cache.getAllFavoriteEntries();
                favoriteEntry = allFavorites.find(
                  (entry) =>
                    entry.magnetLink &&
                    entry.magnetLink.trim() === magnetLink.trim()
                );

                // If not found by direct magnet match, try by torrent data reconstruction
                if (!favoriteEntry) {
                  // This is a fallback - we'd need more context to match properly
                  // For now, we'll just use the old system as fallback
                }
              } catch (entryError) {
                logger.warn('Error checking favorite entries', {
                  error: entryError.message,
                });
              }

              // If we found a favorite entry, save to the new system
              if (favoriteEntry) {
                try {
                  const favoriteScreenshotData = {
                    timestamp: normalizedTimestamp,
                    filename: filename || tempFilename,
                    base64Data: `data:image/jpeg;base64,${base64Screenshot}`,
                    pixhostUrl: pixhostUrl,
                    sizeKB: fileSizeKB,
                    videoUrl: videoUrl.substring(0, 100) + '...',
                    metadata: {
                      generatedAt: new Date().toISOString(),
                      videoUrlFull: videoUrl,
                    },
                  };

                  const favoriteScreenshotSuccess =
                    await cache.addFavoriteScreenshot(
                      favoriteEntry.id,
                      favoriteScreenshotData
                    );

                  if (favoriteScreenshotSuccess) {
                    favoriteEntryUsed = true;
                    cacheSuccess = true;
                    logger.info('Screenshot saved to favorite entry', {
                      favoriteEntryId: favoriteEntry.id,
                      timestamp: normalizedTimestamp,
                    });
                  }
                } catch (favError) {
                  logger.warn(
                    'Failed to save to favorite entry, falling back to old system',
                    {
                      error: favError.message,
                    }
                  );
                }
              }

              // If favorite entry wasn't used, use the old timestamp-based system
              if (!favoriteEntryUsed) {
                // Create a hash of the magnet link for more reliable caching
                const crypto = require('crypto');
                const magnetHash = crypto
                  .createHash('sha256')
                  .update(magnetLink)
                  .digest('hex')
                  .substring(0, 16);
                const cacheKey = `screenshot_${magnetHash}_${normalizedTimestamp}`;

                logger.info('Attempting to cache screenshot (old system)', {
                  cacheKey: cacheKey.substring(0, 100) + '...',
                  cacheKeyLength: cacheKey.length,
                  magnetLinkLength: magnetLink.length,
                  originalTimestamp: timestamp,
                  normalizedTimestamp: normalizedTimestamp,
                  dataSize: JSON.stringify(screenshotData).length,
                });

                cacheSuccess = await cache.set(
                  cacheKey,
                  screenshotData,
                  7 * 24 * 60 * 60
                ); // Cache for 7 days
              }

              logger.info('Cache set result', {
                cacheSuccess: cacheSuccess,
                favoriteEntryUsed: favoriteEntryUsed,
                method: favoriteEntryUsed ? 'favorite_entry' : 'old_system',
              });

              if (cacheSuccess) {
                logger.info('Screenshot cached successfully', {
                  method: favoriteEntryUsed ? 'favorite_entry' : 'old_system',
                  favoriteEntryUsed: favoriteEntryUsed,
                });

                // Verify the cache entry was actually stored by reading it back
                if (!favoriteEntryUsed) {
                  // Only verify old system cache entries
                  const verification = await cache.get(cacheKey);
                  logger.info('Cache verification', {
                    verificationExists: !!verification,
                    verificationTimestamp: verification?.timestamp,
                  });
                }

                // Also maintain a list of available screenshots for this magnet link (old system only)
                if (!favoriteEntryUsed) {
                  const crypto = require('crypto');
                  const magnetHash = crypto
                    .createHash('sha256')
                    .update(magnetLink)
                    .digest('hex')
                    .substring(0, 16);
                  const screenshotsListKey = `screenshots_list_${magnetHash}`;
                  let screenshotsList =
                    (await cache.get(screenshotsListKey)) || [];

                  // Add this screenshot to the list if it's not already there
                  // Use fixed precision for consistency
                  const normalizedTimestamp = Number(timestamp.toFixed(6));
                  const existingIndex = screenshotsList.findIndex(
                    (item) =>
                      Math.abs(item.timestamp - normalizedTimestamp) < 0.000001 // Very small tolerance
                  );

                  if (existingIndex === -1) {
                    screenshotsList.push({
                      timestamp: normalizedTimestamp,
                      filename: filename || tempFilename,
                      generatedAt: new Date().toISOString(),
                    });

                    // Keep only the most recent 50 screenshots to avoid unbounded growth
                    screenshotsList = screenshotsList
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .slice(0, 50);

                    await cache.set(
                      screenshotsListKey,
                      screenshotsList,
                      7 * 24 * 60 * 60
                    );
                    logger.info('Updated screenshots list', {
                      magnetLink: magnetLink.substring(0, 50) + '...',
                      totalScreenshots: screenshotsList.length,
                    });
                  }
                }
              }
            } catch (cacheError) {
              logger.error('Error caching screenshot', {
                error: cacheError.message,
                stack: cacheError.stack,
                magnetLinkLength: magnetLink.length,
                magnetLinkStart: magnetLink.substring(0, 50),
              });
            }
          }

          // Clean up temp file
          fs.unlinkSync(tempPath);

          // Return response
          res.json({
            success: true,
            screenshot: {
              base64: `data:image/jpeg;base64,${base64Screenshot}`,
              pixhostUrl: pixhostUrl,
              timestamp: normalizedTimestamp,
              filename: filename || tempFilename,
              sizeKB: fileSizeKB,
              cached: cacheSuccess,
              generatedAt: new Date().toISOString(),
            },
          });
        } catch (error) {
          logger.error('Error processing screenshot', {
            error: error.message,
            stack: error.stack,
          });

          // Clean up temp file
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }

          res.status(500).json({
            success: false,
            error: 'Failed to process screenshot',
            details: error.message,
          });
        }
      });

      ffmpegProcess.on('error', (error) => {
        logger.error('FFmpeg process error', {
          error: error.message,
        });

        // Clean up temp file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

        res.status(500).json({
          success: false,
          error: 'FFmpeg is not available or failed to start',
          details: error.message,
        });
      });
    } catch (error) {
      logger.error('Video screenshot endpoint error', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: error.message,
      });
    }
  })
);

// POST endpoint for cached screenshots (for very long magnet links)
app.post(
  '/api/video/screenshots',
  asyncHandler(async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const { magnetLink } = req.body;

    if (!magnetLink) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: magnetLink',
      });
    }

    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      logger.info('Retrieving cached screenshots via POST', {
        magnetLink: magnetLink.substring(0, 50) + '...',
        magnetLinkLength: magnetLink.length,
      });

      // Get all cached screenshots for this magnet link (same logic as GET endpoint)
      const screenshots = [];
      const crypto = require('crypto');
      const magnetHash = crypto
        .createHash('sha256')
        .update(magnetLink)
        .digest('hex')
        .substring(0, 16);
      const cacheKeyPrefix = `screenshot_${magnetHash}_`;

      // First, check if there's a screenshots list stored (preferred method)
      const screenshotsListKey = `screenshots_list_${magnetHash}`;
      const screenshotsList = await cache.get(screenshotsListKey);

      logger.info('Checking screenshots list via POST', {
        hasScreenshotsList: !!screenshotsList,
        listLength: screenshotsList ? screenshotsList.length : 0,
      });

      if (screenshotsList && Array.isArray(screenshotsList)) {
        logger.info('Found screenshots in list via POST', {
          timestamps: screenshotsList.map((item) => item.timestamp),
        });

        for (const item of screenshotsList) {
          const cacheKey = `screenshot_${magnetHash}_${item.timestamp}`;
          const cachedData = await cache.get(cacheKey);

          logger.info('Checking cache for timestamp via POST', {
            timestamp: item.timestamp,
            cacheKey: cacheKey.substring(0, 80) + '...',
            found: !!cachedData,
            hasPixhostUrl: cachedData?.pixhostUrl ? true : false,
          });

          if (cachedData) {
            screenshots.push({
              timestamp: item.timestamp,
              ...cachedData,
              cacheKey: cacheKey,
            });
          }
        }
      } else {
        // Fallback: Try to find any existing screenshots and rebuild the list
        logger.info(
          'No screenshots list found via POST, trying to discover existing screenshots'
        );

        // Try a broader range of timestamps that might exist
        const commonTimestamps = [
          30, 60, 120, 180, 300, 600, 900, 1200, 1800, 2400, 3000, 3600,
        ];

        // Also check for more recent timestamps that might have been generated
        const recentTimestamps = [];
        for (let i = 0; i <= 3600; i += 10) {
          // Check every 10 seconds up to 1 hour
          recentTimestamps.push(i);
        }

        const allTimestamps = [
          ...new Set([...commonTimestamps, ...recentTimestamps]),
        ].sort((a, b) => a - b);
        const discoveredScreenshots = [];

        logger.info(
          'Fallback via POST: trying to discover cached screenshots',
          {
            magnetHash: magnetHash,
            cacheKeyPrefix: cacheKeyPrefix,
            commonTimestamps: commonTimestamps.length,
            recentTimestamps: recentTimestamps.length,
            totalTimestamps: allTimestamps.length,
          }
        );

        for (const timestamp of allTimestamps) {
          const cacheKey = `${cacheKeyPrefix}${timestamp}`;
          const cachedData = await cache.get(cacheKey);

          if (cachedData) {
            logger.info('Found cached screenshot in fallback via POST', {
              timestamp: timestamp,
              cacheKey: cacheKey.substring(0, 80) + '...',
              hasPixhostUrl: !!cachedData.pixhostUrl,
              filename: cachedData.filename,
            });

            screenshots.push({
              timestamp: timestamp,
              ...cachedData,
              cacheKey: cacheKey,
            });

            discoveredScreenshots.push({
              timestamp: timestamp,
              filename: cachedData.filename || `Screenshot at ${timestamp}s`,
              generatedAt: cachedData.generatedAt || new Date().toISOString(),
            });
          }
        }

        // If we found any screenshots, create the screenshots list for future use
        if (discoveredScreenshots.length > 0) {
          try {
            await cache.set(
              screenshotsListKey,
              discoveredScreenshots,
              7 * 24 * 60 * 60
            );
            logger.info(
              'Created screenshots list from discovered screenshots via POST',
              {
                count: discoveredScreenshots.length,
              }
            );
          } catch (error) {
            logger.warn('Failed to create screenshots list via POST', {
              error: error.message,
            });
          }
        }
      }

      logger.info('Retrieved cached screenshots via POST', {
        count: screenshots.length,
        magnetHash: magnetHash,
      });

      res.json({
        success: true,
        magnetLink: magnetLink,
        screenshots: screenshots,
        count: screenshots.length,
      });
    } catch (error) {
      logger.error('Error retrieving cached screenshots via POST', {
        error: error.message,
        stack: error.stack,
        magnetLinkLength: magnetLink ? magnetLink.length : 0,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve cached screenshots',
        details: error.message,
      });
    }
  })
);

// Get cached screenshots for a magnet link
app.get(
  '/api/video/screenshots/:magnetLink',
  asyncHandler(async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const { magnetLink: encodedMagnetLink } = req.params;

    if (!encodedMagnetLink) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: magnetLink',
      });
    }

    // URL decode the magnet link to ensure consistency with cache keys
    const magnetLink = decodeURIComponent(encodedMagnetLink);

    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      logger.info('Retrieving cached screenshots', {
        encodedMagnetLink: encodedMagnetLink.substring(0, 50) + '...',
        decodedMagnetLink: magnetLink.substring(0, 50) + '...',
      });

      // Get all cached screenshots for this magnet link
      const screenshots = [];
      const crypto = require('crypto');
      const magnetHash = crypto
        .createHash('sha256')
        .update(magnetLink)
        .digest('hex')
        .substring(0, 16);
      const cacheKeyPrefix = `screenshot_${magnetHash}_`;

      // First, check if there's a screenshots list stored (preferred method)
      const screenshotsListKey = `screenshots_list_${magnetHash}`;
      const screenshotsList = await cache.get(screenshotsListKey);

      logger.info('Checking screenshots list', {
        hasScreenshotsList: !!screenshotsList,
        listLength: screenshotsList ? screenshotsList.length : 0,
      });

      if (screenshotsList && Array.isArray(screenshotsList)) {
        logger.info('Found screenshots in list', {
          timestamps: screenshotsList.map((item) => item.timestamp),
        });

        for (const item of screenshotsList) {
          const cacheKey = `screenshot_${magnetHash}_${item.timestamp}`;
          const cachedData = await cache.get(cacheKey);

          logger.info('Checking cache for timestamp', {
            timestamp: item.timestamp,
            timestampType: typeof item.timestamp,
            cacheKey: cacheKey.substring(0, 80) + '...',
            fullCacheKey: cacheKey,
            hasCachedData: !!cachedData,
            itemDetails: item,
          });

          if (cachedData) {
            screenshots.push({
              timestamp: item.timestamp,
              ...cachedData,
              cacheKey: cacheKey,
            });
          } else {
            // Try alternative formats in case there's a precision issue
            const alternativeKeys = [
              `screenshot_${magnetHash}_${
                Math.round(item.timestamp * 1000000) / 1000000
              }`,
              `screenshot_${magnetHash}_${Number(item.timestamp.toFixed(6))}`,
              `screenshot_${magnetHash}_${item.timestamp.toString()}`,
            ];

            for (const altKey of alternativeKeys) {
              if (altKey !== cacheKey) {
                const altData = await cache.get(altKey);
                if (altData) {
                  logger.info('Found screenshot with alternative key', {
                    originalKey: cacheKey,
                    workingKey: altKey,
                    timestamp: item.timestamp,
                  });
                  screenshots.push({
                    timestamp: item.timestamp,
                    ...altData,
                    cacheKey: altKey,
                  });
                  break;
                }
              }
            }
          }
        }
      } else {
        // Fallback: Try to find any existing screenshots and rebuild the list
        logger.info(
          'No screenshots list found, trying to discover existing screenshots'
        );

        // Try a broader range of timestamps that might exist
        const commonTimestamps = [
          30, 60, 120, 180, 300, 600, 900, 1200, 1800, 2400, 3000, 3600,
        ];

        // Also check for more recent timestamps that might have been generated
        const recentTimestamps = [];
        for (let i = 0; i <= 3600; i += 10) {
          // Check every 10 seconds up to 1 hour
          recentTimestamps.push(i);
        }

        const allTimestamps = [
          ...new Set([...commonTimestamps, ...recentTimestamps]),
        ].sort((a, b) => a - b);
        const discoveredScreenshots = [];

        logger.info('Fallback: trying to discover cached screenshots', {
          magnetHash: magnetHash,
          cacheKeyPrefix: cacheKeyPrefix,
          commonTimestamps: commonTimestamps.length,
          recentTimestamps: recentTimestamps.length,
          totalTimestamps: allTimestamps.length,
        });

        for (const timestamp of allTimestamps) {
          const cacheKey = `${cacheKeyPrefix}${timestamp}`;
          const cachedData = await cache.get(cacheKey);

          if (cachedData) {
            logger.info('Found cached screenshot in fallback', {
              timestamp: timestamp,
              cacheKey: cacheKey.substring(0, 80) + '...',
              hasPixhostUrl: !!cachedData.pixhostUrl,
              filename: cachedData.filename,
            });

            screenshots.push({
              timestamp: timestamp,
              ...cachedData,
              cacheKey: cacheKey,
            });

            discoveredScreenshots.push({
              timestamp: timestamp,
              filename: cachedData.filename || `Screenshot at ${timestamp}s`,
              generatedAt: cachedData.generatedAt || new Date().toISOString(),
            });
          }
        }

        // If we found any screenshots, create the screenshots list for future use
        if (discoveredScreenshots.length > 0) {
          try {
            await cache.set(
              screenshotsListKey,
              discoveredScreenshots,
              7 * 24 * 60 * 60
            );
            logger.info(
              'Created screenshots list from discovered screenshots',
              {
                count: discoveredScreenshots.length,
              }
            );
          } catch (error) {
            logger.warn('Failed to create screenshots list', {
              error: error.message,
            });
          }
        }
      }

      // Sort by timestamp
      screenshots.sort((a, b) => a.timestamp - b.timestamp);

      logger.info('Retrieved cached screenshots', {
        magnetLink: magnetLink.substring(0, 50) + '...',
        count: screenshots.length,
      });

      res.json({
        success: true,
        magnetLink: magnetLink,
        screenshots: screenshots,
        count: screenshots.length,
      });
    } catch (error) {
      logger.error('Error retrieving cached screenshots', {
        error: error.message,
        magnetLink: magnetLink.substring(0, 50) + '...',
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve cached screenshots',
        details: error.message,
      });
    }
  })
);

// Debug endpoint to check cache contents
app.get(
  '/api/debug/cache/:magnetLink',
  asyncHandler(async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    if (!cache) {
      return res.json({ error: 'Cache not available' });
    }

    const { magnetLink: encodedMagnetLink } = req.params;
    const magnetLink = decodeURIComponent(encodedMagnetLink);

    try {
      const crypto = require('crypto');
      const magnetHash = crypto
        .createHash('sha256')
        .update(magnetLink)
        .digest('hex')
        .substring(0, 16);

      // Check for screenshots list
      const screenshotsListKey = `screenshots_list_${magnetHash}`;
      const screenshotsList = await cache.get(screenshotsListKey);

      // Try to find cache entries directly - use normalized precision
      const timestamps = [
        Number((749.136927).toFixed(6)),
        749.136927,
        721.023004,
        577.028304,
        732.260614,
        30,
        60,
        120,
        300,
        600,
      ];
      const cacheResults = {};

      for (const timestamp of timestamps) {
        const cacheKey = `screenshot_${magnetHash}_${timestamp}`;
        const cachedData = await cache.get(cacheKey);
        cacheResults[timestamp] = {
          cacheKey: cacheKey,
          exists: !!cachedData,
          data: cachedData
            ? {
                timestamp: cachedData.timestamp,
                filename: cachedData.filename,
                hasPixhostUrl: !!cachedData.pixhostUrl,
                hasBase64: !!cachedData.base64,
                generatedAt: cachedData.generatedAt,
              }
            : null,
        };
      }

      res.json({
        magnetLink: magnetLink.substring(0, 50) + '...',
        magnetHash: magnetHash,
        screenshotsListExists: !!screenshotsList,
        screenshotsList: screenshotsList,
        cacheResults: cacheResults,
        debug: {
          magnetLinkLength: magnetLink.length,
          firstChars: magnetLink.substring(0, 20),
          cacheKeyFormat: `screenshot_${magnetHash}_[timestamp]`,
          screenshotsListKey: screenshotsListKey,
        },
      });
    } catch (error) {
      res.json({ error: error.message, stack: error.stack });
    }
  })
);

app.use('/api/:website/:query/:page?', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  let website = req.params.website.toLowerCase();
  let query = req.params.query;
  let page = req.params.page;

  // Extract query parameters for filtering options
  const options = {
    minSeeders: req.query.minSeeders ? parseInt(req.query.minSeeders) : null,
    maxResults: req.query.maxResults ? parseInt(req.query.maxResults) : null,
  };

  if (website == 'all') {
    // Set a timeout to prevent serverless function timeout
    const TIMEOUT_MS = 8000; // 8 seconds (less than Vercel's 10s limit)

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), TIMEOUT_MS);
    });

    Promise.race([combo(query, page, options), timeoutPromise])
      .then((v) => {
        res.json(v);
      })
      .catch((error) => {
        logger.warn('Torrent search timeout or error', {
          error: error.message,
          query,
          website: 'all',
        });
        res.status(408).json({
          error:
            'Search request timed out. Try searching individual providers instead.',
          suggestion: 'Use /api/torrents to see available providers',
          availableProviders: Object.keys(torrents),
        });
      });
  } else if (torrents[website]) {
    torrents[website](query, page, options).then((v) => {
      res.json(v);
    });
  } else {
    res.json({
      error: `Please select "${Object.keys(torrents).join(' | ')}"`,
    });
  }
});

app.get('/api/torrents', (req, res) => {
  res.json(Object.keys(torrents));
});

// Database statistics endpoint
app.get(
  '/api/database/stats',
  asyncHandler(async (req, res) => {
    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
      });
    }

    const stats = await cache.getStats();
    res.json({
      success: true,
      stats,
    });
  })
);

app.use('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Debug endpoint to check cache contents for a magnet link
app.get(
  '/api/debug/cache/:magnetLink',
  asyncHandler(async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const { magnetLink: encodedMagnetLink } = req.params;
    const magnetLink = decodeURIComponent(encodedMagnetLink);

    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const crypto = require('crypto');
      const magnetHash = crypto
        .createHash('sha256')
        .update(magnetLink)
        .digest('hex')
        .substring(0, 16);

      logger.info('Debug cache request', {
        magnetLink: magnetLink.substring(0, 50) + '...',
        magnetHash: magnetHash,
      });

      // Check screenshots list
      const screenshotsListKey = `screenshots_list_${magnetHash}`;
      const screenshotsList = await cache.get(screenshotsListKey);

      // Check for individual cache keys (common timestamps)
      const commonTimestamps = [
        30, 60, 120, 180, 300, 600, 900, 1200, 1800, 2400, 3000, 3600,
      ];
      const cacheResults = {};

      for (const timestamp of commonTimestamps) {
        const cacheKey = `screenshot_${magnetHash}_${timestamp}`;
        const cachedData = await cache.get(cacheKey);
        cacheResults[cacheKey] = !!cachedData;
        if (cachedData) {
          logger.info('Found cached screenshot during debug', {
            timestamp,
            cacheKey: cacheKey.substring(0, 80) + '...',
            hasPixhostUrl: !!cachedData.pixhostUrl,
            cached: cachedData.cached,
            filename: cachedData.filename,
          });
        }
      }

      // Also check for any keys that might match the pattern
      const allMatchingKeys = [];
      const keyPattern = `screenshot_${magnetHash}_`;

      // Check for a broader range of possible timestamps
      const extendedTimestamps = [];
      for (let i = 0; i <= 7200; i += 10) {
        // Check every 10 seconds up to 2 hours
        extendedTimestamps.push(i);
      }

      const extendedCacheResults = {};
      let foundCount = 0;
      for (const timestamp of extendedTimestamps) {
        const cacheKey = `screenshot_${magnetHash}_${timestamp}`;
        try {
          const cachedData = await cache.get(cacheKey);
          if (cachedData) {
            extendedCacheResults[cacheKey] = {
              exists: true,
              timestamp: timestamp,
              hasPixhostUrl: !!cachedData.pixhostUrl,
              filename: cachedData.filename,
              generatedAt: cachedData.generatedAt,
            };
            allMatchingKeys.push(cacheKey);
            foundCount++;

            // Stop after finding 20 to avoid too much output
            if (foundCount >= 20) break;
          }
        } catch (error) {
          // Ignore errors for non-existent keys
        }
      }

      res.json({
        success: true,
        magnetLink: magnetLink,
        magnetHash: magnetHash,
        screenshotsListExists: !!screenshotsList,
        screenshotsList: screenshotsList,
        cacheResults: cacheResults,
        extendedCacheResults: extendedCacheResults,
        allMatchingKeys: allMatchingKeys,
        totalFoundScreenshots: allMatchingKeys.length,
        debug: {
          screenshotsListKey: screenshotsListKey,
          magnetLinkLength: magnetLink.length,
          keyPattern: keyPattern,
          timestampsChecked: commonTimestamps.length,
          extendedTimestampsChecked: extendedTimestamps.length,
        },
      });
    } catch (error) {
      logger.error('Error debugging cache', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to debug cache',
        details: error.message,
      });
    }
  })
);

// === GENERIC CACHE API ENDPOINTS FOR MIGRATION ===

// Set generic cache item (for migration utility)
app.post('/api/cache/set', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { key, value, ttlSeconds, type, metadata } = req.body;

    if (!key) {
      return res.status(400).json({
        success: false,
        error: 'Key is required',
      });
    }

    const success = await cache.set(
      key,
      value,
      ttlSeconds || null,
      type || 'json',
      metadata || null
    );

    if (success) {
      res.json({
        success: true,
        message: 'Cache item set successfully',
        key: key,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to set cache item',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to set cache item',
      message: error.message,
    });
  }
});

// Get generic cache item
app.get('/api/cache/get/:key', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { key } = req.params;
    const value = await cache.get(key);

    res.json({
      success: true,
      key: key,
      value: value,
      found: value !== null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cache item',
      message: error.message,
    });
  }
});

// Delete generic cache item
app.delete('/api/cache/delete/:key', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { key } = req.params;
    const success = await cache.delete(key);

    res.json({
      success: true,
      deleted: success,
      key: key,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to delete cache item',
      message: error.message,
    });
  }
});

// === IMAGE PROXY ENDPOINT (for CORS issues) ===

// Proxy endpoint to fetch images that have CORS restrictions
app.get('/api/proxy/image', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL parameter is required',
    });
  }

  try {
    // Validate URL
    new URL(url);

    // Fetch the image with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TorrentSearchBot/1.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `Failed to fetch image: ${response.status} ${response.statusText}`,
      });
    }

    // Get content type
    const contentType = response.headers.get('content-type');

    // Validate that it's an image
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        error: 'URL does not point to an image',
      });
    }

    // Stream the image to the client
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    response.body.pipe(res);
  } catch (error) {
    logger.error('Image proxy error', {
      error: error.message,
      url: url.substring(0, 100),
    });

    // Handle specific error types
    let statusCode = 500;
    let errorMessage = 'Failed to proxy image';

    if (error.name === 'AbortError') {
      statusCode = 408; // Request Timeout
      errorMessage = 'Image fetch timeout (15s limit exceeded)';
    } else if (error.message.includes('fetch')) {
      statusCode = 502; // Bad Gateway
      errorMessage = 'Unable to fetch image from source';
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      message: error.message,
    });
  }
});

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Server variable for graceful shutdown
let server = null;

// Export app for Lambda, or start server for local development
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  // Running in Lambda - export the app
  module.exports = app;
} else {
  // Running locally - start the server
  const PORT = config.server.port;
  const HOST = config.server.host;

  server = app.listen(PORT, HOST, () => {
    logger.info('Server started successfully', {
      port: PORT,
      host: HOST,
      environment: config.environment,
      nodeVersion: process.version,
      pid: process.pid,
    });
  });
}

// Graceful shutdown handling (only for local server, not Lambda)
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    if (server) {
      server.close(() => {
        logger.info('HTTP server closed');
      });
    }

    // Cleanup database connections
    if (cache) {
      try {
        await cache.cleanup();
        await cache.close();
        logger.info('Database connections closed');
      } catch (error) {
        logger.error('Error during database cleanup', { error: error.message });
      }
    }

    // Exit process
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });

  if (config.isProduction) {
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
  });

  if (config.isProduction) {
    gracefulShutdown('UNHANDLED_REJECTION');
  }
});

// Run cleanup every hour
setInterval(() => {
  cache.cleanup();
}, 60 * 60 * 1000); // 1 hour
