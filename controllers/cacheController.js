const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');

// Cache controller for all cache-related endpoints
const cacheController = {
  // Get cache statistics
  getStats: async (req, res) => {
    const cache = req.app.locals.cache;
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
  },

  // Clear all caches
  clearAll: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
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
  },

  // Store cover image
  storeCoverImage: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const { torrent, imageData, mimeType, imageUrl } = req.body;

      if (!torrent) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: torrent',
        });
      }

      if (!imageData && !imageUrl) {
        return res.status(400).json({
          success: false,
          error: 'Either imageData or imageUrl is required',
        });
      }

      let success;
      if (imageData) {
        // Store binary image data
        const buffer = Buffer.from(imageData, 'base64');
        success = await cache.storeCoverImage(
          torrent,
          buffer,
          mimeType || 'image/jpeg'
        );
      } else {
        // Store image URL
        success = await cache.storeCoverImageUrl(torrent, imageUrl);
      }

      if (success) {
        res.json({
          success: true,
          message: 'Cover image stored successfully',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to store cover image',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to store cover image',
        message: error.message,
      });
    }
  },

  // Get cover image
  getCoverImage: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const torrentKey = req.params.torrentKey;

      const imageData = await cache.getCoverImageByKey(torrentKey);

      if (imageData) {
        if (imageData.type === 'blob') {
          res.setHeader('Content-Type', imageData.mimeType || 'image/jpeg');
          res.send(imageData.data);
        } else {
          res.json({
            success: true,
            imageUrl: imageData.imageUrl,
            type: 'url',
          });
        }
      } else {
        res.status(404).json({
          success: false,
          error: 'Cover image not found',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get cover image',
        message: error.message,
      });
    }
  },

  // Store stream URL
  storeStreamUrl: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
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
          message: 'Stream URL stored successfully',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to store stream URL',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to store stream URL',
        message: error.message,
      });
    }
  },

  // Get stream URL
  getStreamUrl: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const magnetHash = req.params.magnetHash;
      const streamData = await cache.getStreamUrl(magnetHash);

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
  },

  // Add cached link
  addCachedLink: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const { url, title } = req.body;

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
  },

  // Get cached links
  getCachedLinks: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const cachedLinks = await cache.getCachedLinks();
      res.json({
        success: true,
        cachedLinks,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get cached links',
        message: error.message,
      });
    }
  },

  // Remove cached link
  removeCachedLink: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
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
  },

  // Update cached link
  updateCachedLink: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
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
  },

  // Set generic cache value
  setCacheValue: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const { key, value, ttl } = req.body;

      if (!key || value === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: key and value',
        });
      }

      await cache.set(key, value, ttl);
      res.json({
        success: true,
        message: 'Value cached successfully',
        key,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to cache value',
        message: error.message,
      });
    }
  },

  // Get generic cache value
  getCacheValue: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const { key } = req.params;
      const value = await cache.get(key);

      if (value !== undefined) {
        res.json({
          success: true,
          key,
          value,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Key not found in cache',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get cached value',
        message: error.message,
      });
    }
  },

  // Delete generic cache value
  deleteCacheValue: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const cache = req.app.locals.cache;
    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const { key } = req.params;
      await cache.delete(key);

      res.json({
        success: true,
        message: 'Cache entry deleted successfully',
        key,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete cache entry',
        message: error.message,
      });
    }
  },
};

// Helper function to extract title from URL
function extractTitleFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;

    // Extract filename without extension
    const filename = pathname.split('/').pop();
    const title = filename.split('.').slice(0, -1).join('.');

    // If no meaningful title, use hostname
    return title || parsedUrl.hostname;
  } catch {
    return url;
  }
}

// Export individual controller functions for direct route binding
module.exports = {
  getStats: cacheController.getStats,
  clearAll: cacheController.clearAll,
  storeCoverImage: cacheController.storeCoverImage,
  getCoverImage: cacheController.getCoverImage,
  storeStreamUrl: cacheController.storeStreamUrl,
  getStreamUrl: cacheController.getStreamUrl,
  addCachedLink: cacheController.addCachedLink,
  getCachedLinks: cacheController.getCachedLinks,
  removeCachedLink: cacheController.removeCachedLink,
  updateCachedLink: cacheController.updateCachedLink,
  setCacheValue: cacheController.setCacheValue,
  getCacheValue: cacheController.getCacheValue,
  deleteCacheValue: cacheController.deleteCacheValue,
};
