const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');

// Storage controller for all Turso database storage endpoints
const storageController = {
  // Get storage statistics
  getStats: async (req, res) => {
    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const stats = await storage.getStats();
      res.json({
        success: true,
        stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get storage statistics',
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

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
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

      // Always use the setCoverImage method which handles Pixhost upload
      const success = await storage.setCoverImage(torrent, imageUrl, imageData);

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

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const torrentKey = req.params.torrentKey;

      const imageData = await storage.getCoverImageByKey(torrentKey);

      if (imageData) {
        res.json({
          success: true,
          imageUrl: imageData.imageUrl,
          type: 'url',
          originalUrl: imageData.originalUrl,
          fallbackUrls: imageData.fallbackUrls || [],
        });
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

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
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

      const success = await storage.setStreamUrl(magnetLink, streamData);

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

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const magnetHash = req.params.magnetHash;
      const streamData = await storage.getStreamUrlByHash(magnetHash);

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

  // Deep refresh: re-runs the full StreamUrlRefreshService flow for one magnet
  // (add → poll → unrestrict → HEAD-validate, with retry that deletes the
  // stale RD torrent and re-adds the magnet on transient failure).
  // Used by the frontend regen path so a single bad RD torrent can self-heal
  // instead of falling into a loop of fresh-but-still-dead /unrestrict URLs.
  refreshStreamUrl: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    const authHeader = req.headers.authorization || '';
    const apiKey = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Real-Debrid API key required in Authorization header',
      });
    }

    const { magnetLink, torrentName } = req.body || {};
    if (!magnetLink || typeof magnetLink !== 'string' || !magnetLink.startsWith('magnet:')) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid magnetLink',
      });
    }

    try {
      const StreamUrlRefreshService = require('../services/streamUrlRefreshService');
      // authService stub: refreshStreamUrl path doesn't use it (it only consumes
      // the apiKey we pass through), so a no-op object is enough.
      const refreshService = new StreamUrlRefreshService(storage, {});

      const result = await refreshService.refreshStreamUrl(
        magnetLink,
        apiKey,
        torrentName || 'Unknown'
      );

      if (!result.success) {
        return res.status(502).json({
          success: false,
          error: result.error || 'Refresh failed',
        });
      }

      // Refresh service writes through storage.setStreamUrl, so read it back
      // to return the freshly cached URL to the caller.
      const cached = await storage.getStreamUrl(magnetLink);
      if (!cached) {
        return res.status(500).json({
          success: false,
          error: 'Refresh reported success but cache read returned empty',
        });
      }

      return res.json({
        success: true,
        ...cached,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to refresh stream URL',
        message: error.message,
      });
    }
  },

  // Add stored link
  addStoredLink: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization'
    );

    const storage = req.app.locals.cache;
    if (!storage || !storage.isInitialized) {
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

      const storedLink = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        url,
        title: title || extractTitleFromUrl(url),
        dateAdded: new Date().toISOString(),
      };

      // Extract userId from authentication (optional)
      const userId = req.userId || null;

      // Force console output

      const success = await storage.addCachedLink(storedLink, userId);

      if (success) {
        res.json({
          success: true,
          message: 'Link stored successfully',
          storedLink,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to store link',
        });
      }
    } catch (error) {
      // Check if error is due to database not being available
      if (
        error.message.includes('Database client not initialized') ||
        error.message.includes('not initialized')
      ) {
        return res.status(503).json({
          success: false,
          error: 'Cache not available',
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to store link',
        message: error.message,
      });
    }
  },

  // Get stored links
  getStoredLinks: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization'
    );

    const storage = req.app.locals.cache;
    if (!storage || !storage.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      // Extract pagination parameters
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;

      // Extract userId from authentication (optional)
      const userId = req.userId || null;

      const result = await storage.getCachedLinks(page, limit, userId);

      // Flatten the response structure to match frontend expectations
      // Frontend expects: { storedLinks: [...], pagination: {...} }
      // But UnifiedCache returns: { cachedLinks: [...], pagination: {...} }
      res.json({
        success: true,
        storedLinks: result.cachedLinks || [],
        pagination: result.pagination || {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit: limit,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });
    } catch (error) {
      // Check if error is due to database not being available
      if (
        error.message.includes('Database client not initialized') ||
        error.message.includes('not initialized')
      ) {
        return res.status(503).json({
          success: false,
          error: 'Cache not available',
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to get stored links',
        message: error.message,
      });
    }
  },

  // Remove stored link
  removeStoredLink: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
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

      // Extract userId from authentication (optional)
      const userId = req.userId || null;

      const success = await storage.removeCachedLink(id, userId);

      if (success) {
        res.json({
          success: true,
          message: 'Cached link removed successfully',
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Cached link not found or access denied',
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

  // Update stored link
  updateStoredLink: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
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

      // Extract userId from authentication (optional)
      const userId = req.userId || null;

      const success = await storage.updateCachedLink(id, updates, userId);

      if (success) {
        res.json({
          success: true,
          message: 'Cached link updated successfully',
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Cached link not found or access denied',
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

    const storage = req.app.locals.cache;
    if (!storage || !storage.isInitialized) {
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

      await storage.set(key, value, ttl);
      res.json({
        success: true,
        message: 'Value cached successfully',
        key,
      });
    } catch (error) {
      // Check if error is due to database not being available
      if (
        error.message.includes('Database client not initialized') ||
        error.message.includes('not initialized')
      ) {
        return res.status(503).json({
          success: false,
          error: 'Cache not available',
        });
      }

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

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const { key } = req.params;
      const value = await storage.get(key);

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

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const { key } = req.params;
      await storage.delete(key);

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

  // Update cover image for favorite entry
  updateFavoriteEntryCoverImage: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const { favoriteId } = req.params;
      const { coverImageUrl } = req.body;

      if (!favoriteId || !coverImageUrl) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: favoriteId and coverImageUrl',
        });
      }

      const success = await storage.updateFavoriteEntryCoverImage(
        favoriteId,
        coverImageUrl
      );

      if (success) {
        res.json({
          success: true,
          message: 'Favorite entry cover image updated successfully',
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Favorite entry not found',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update favorite entry cover image',
        message: error.message,
      });
    }
  },

  // Update magnet link for favorite entry
  updateFavoriteEntryMagnetLink: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const { favoriteId } = req.params;
      const { magnetLink } = req.body;

      if (!favoriteId || !magnetLink) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: favoriteId and magnetLink',
        });
      }

      const success = await storage.updateFavoriteEntryMagnetLink(
        favoriteId,
        magnetLink
      );

      if (success) {
        res.json({
          success: true,
          message: 'Favorite entry magnet link updated successfully',
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Favorite entry not found',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update favorite entry magnet link',
        message: error.message,
      });
    }
  },

  // Update cover image for torrent details
  updateTorrentDetailsCoverImage: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const { favoriteId, source } = req.params;
      const { coverImageUrl } = req.body;

      if (!favoriteId || !source || !coverImageUrl) {
        return res.status(400).json({
          success: false,
          error:
            'Missing required fields: favoriteId, source, and coverImageUrl',
        });
      }

      const success = await storage.updateTorrentDetailsCoverImage(
        favoriteId,
        source,
        coverImageUrl
      );

      if (success) {
        res.json({
          success: true,
          message: 'Torrent details cover image updated successfully',
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Torrent details not found',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update torrent details cover image',
        message: error.message,
      });
    }
  },

  // Update cover image for cached link
  updateCachedLinkCoverImage: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const { cachedLinkId } = req.params;
      const { coverImageUrl } = req.body;

      if (!cachedLinkId || !coverImageUrl) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: cachedLinkId and coverImageUrl',
        });
      }

      const success = await storage.updateCachedLinkCoverImage(
        cachedLinkId,
        coverImageUrl
      );

      if (success) {
        res.json({
          success: true,
          message: 'Cached link cover image updated successfully',
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
        error: 'Failed to update cached link cover image',
        message: error.message,
      });
    }
  },

  // Get cover image for any torrent
  getCoverImageForTorrent: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const torrent = req.body;

      if (!torrent) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: torrent',
        });
      }

      const coverImage = await storage.getCoverImageForTorrent(torrent);

      if (coverImage) {
        res.json({
          success: true,
          imageUrl: coverImage.imageUrl || coverImage,
          originalUrl: coverImage.originalUrl || coverImage,
          fallbackUrls: coverImage.fallbackUrls || [],
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Cover image not found for torrent',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get cover image for torrent',
        message: error.message,
      });
    }
  },

  // Store magnet link
  storeMagnetLink: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const { source, url, magnet, torrentName } = req.body;

      if (!source || !url || !magnet) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: source, url, magnet',
        });
      }

      // Create a unique key for this magnet link
      const magnetKey = `magnet:${source.toLowerCase()}:${Buffer.from(url).toString('base64').substring(0, 100)}`;

      // Store magnet link with metadata
      const magnetData = {
        source,
        url,
        magnet,
        torrentName: torrentName || 'Unknown',
        cachedAt: new Date().toISOString(),
      };

      await storage.set(magnetKey, JSON.stringify(magnetData));

      res.json({
        success: true,
        message: 'Magnet link stored successfully',
      });
    } catch (error) {
      console.error('Error storing magnet link:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to store magnet link',
        message: error.message,
      });
    }
  },

  // Get magnet link
  getMagnetLink: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const storage = req.app.locals.cache;
    if (!storage) {
      return res.status(503).json({
        success: false,
        error: 'Storage not available',
      });
    }

    try {
      const { source, url } = req.query;

      if (!source || !url) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: source, url',
        });
      }

      // Create the same key format
      const magnetKey = `magnet:${source.toLowerCase()}:${Buffer.from(url).toString('base64').substring(0, 100)}`;

      const cachedData = await storage.get(magnetKey);

      if (!cachedData) {
        return res.status(404).json({
          success: false,
          error: 'Magnet link not found in cache',
        });
      }

      const magnetData = JSON.parse(cachedData);

      res.json({
        success: true,
        data: magnetData,
      });
    } catch (error) {
      console.error('Error retrieving magnet link:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve magnet link',
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
  getStats: storageController.getStats,
  storeCoverImage: storageController.storeCoverImage,
  getCoverImage: storageController.getCoverImage,
  storeStreamUrl: storageController.storeStreamUrl,
  getStreamUrl: storageController.getStreamUrl,
  refreshStreamUrl: storageController.refreshStreamUrl,
  addCachedLink: storageController.addStoredLink,
  getCachedLinks: storageController.getStoredLinks,
  removeCachedLink: storageController.removeStoredLink,
  updateCachedLink: storageController.updateStoredLink,
  setCacheValue: storageController.setCacheValue,
  getCacheValue: storageController.getCacheValue,
  deleteCacheValue: storageController.deleteCacheValue,
  updateFavoriteEntryCoverImage:
    storageController.updateFavoriteEntryCoverImage,
  updateFavoriteEntryMagnetLink:
    storageController.updateFavoriteEntryMagnetLink,
  updateTorrentDetailsCoverImage:
    storageController.updateTorrentDetailsCoverImage,
  updateCachedLinkCoverImage: storageController.updateStoredLinkCoverImage,
  getCoverImageForTorrent: storageController.getCoverImageForTorrent,
  storeMagnetLink: storageController.storeMagnetLink,
  getMagnetLink: storageController.getMagnetLink,
};
