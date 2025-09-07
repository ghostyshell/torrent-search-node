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
const combo = require('../torrent/COMBO');
const UnifiedCache = require('../database/UnifiedCache');
const googleImagesService = require('../services/googleImagesService');

const app = express();

// Initialize cache
const cache = new UnifiedCache();

// Middleware
app.use(express.json());
app.use(corsMiddleware);

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Health check routes
app.use('/health', require('../routes/health'));

// API routes
app.get(
  '/api/torrents',
  asyncHandler(async (req, res) => {
    const sites = combo.getAllSites();
    res.json(sites);
  })
);

app.get(
  '/api/:site/:query/:page?',
  asyncHandler(async (req, res) => {
    const { site, query, page = 1 } = req.params;

    if (!query || query.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Query parameter is required',
          code: 'MISSING_QUERY',
          statusCode: 400,
        },
      });
    }

    const pageNum = parseInt(page) || 1;
    if (pageNum < 1 || pageNum > 50) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Page must be between 1 and 50',
          code: 'INVALID_PAGE',
          statusCode: 400,
        },
      });
    }

    // Check cache first
    const cacheKey = `${site}:${query}:${pageNum}`;
    const cachedResult = await cache.get(cacheKey);

    if (cachedResult) {
      logger.info('Cache hit', { site, query, page: pageNum });
      return res.json(cachedResult);
    }

    try {
      const results = await combo.search(site, query, pageNum);

      if (!results || results.length === 0) {
        return res.status(404).json({
          success: false,
          error: {
            message: 'No torrents found',
            code: 'NO_RESULTS',
            statusCode: 404,
          },
        });
      }

      // Cache the results for 1 hour
      await cache.set(cacheKey, results, 3600);

      logger.info('Search completed', {
        site,
        query,
        page: pageNum,
        resultCount: results.length,
      });

      res.json(results);
    } catch (error) {
      logger.error('Search failed', {
        site,
        query,
        page: pageNum,
        error: error.message,
      });

      res.status(500).json({
        success: false,
        error: {
          message: config.isProduction ? 'Search failed' : error.message,
          code: 'SEARCH_ERROR',
          statusCode: 500,
        },
      });
    }
  })
);

// Google Images API endpoint
app.get(
  '/api/images/:query',
  asyncHandler(async (req, res) => {
    const { query } = req.params;
    const { num = 10, safe = 'active' } = req.query;

    if (!query || query.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Query parameter is required',
          code: 'MISSING_QUERY',
          statusCode: 400,
        },
      });
    }

    try {
      const images = await googleImagesService.searchImages(query, {
        num: parseInt(num) || 10,
        safe,
      });

      res.json({
        success: true,
        query,
        images,
      });
    } catch (error) {
      logger.error('Image search failed', { query, error: error.message });

      res.status(500).json({
        success: false,
        error: {
          message: config.isProduction ? 'Image search failed' : error.message,
          code: 'IMAGE_SEARCH_ERROR',
          statusCode: 500,
        },
      });
    }
  })
);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Torrent Search API',
    version: '1.0.0',
    endpoints: {
      torrents: '/api/torrents',
      search: '/api/{site}/{query}/{page?}',
      images: '/api/images/{query}',
      health: '/health',
    },
  });
});

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Export for Vercel
module.exports = app;
