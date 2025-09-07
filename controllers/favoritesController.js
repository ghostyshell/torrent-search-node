const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');

// Favorites controller for all favorites-related endpoints
const favoritesController = {
  // Add favorite
  addFavorite: async (req, res) => {
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
      const { torrent } = req.body;

      if (!torrent) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: torrent',
        });
      }

      const success = await cache.addFavorite(torrent);

      if (success) {
        res.json({
          success: true,
          message: 'Favorite added successfully',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to add favorite',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to add favorite',
        message: error.message,
      });
    }
  },

  // Get favorites
  getFavorites: async (req, res) => {
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
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
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
          totalPages: totalPages,
          totalCount: totalCount,
          limit: limit,
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
  },

  // Remove favorite
  removeFavorite: async (req, res) => {
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
      const { torrent } = req.body;

      if (!torrent) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: torrent',
        });
      }

      const success = await cache.removeFavorite(torrent);

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
  },

  // Get favorite details
  getFavoriteDetails: async (req, res) => {
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
      const { favoriteId } = req.params;

      if (!favoriteId) {
        return res.status(400).json({
          success: false,
          error: 'Missing favoriteId parameter',
        });
      }

      const details = await cache.getFavoriteDetails(favoriteId);

      if (details) {
        res.json({
          success: true,
          details,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Favorite details not found',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get favorite details',
        message: error.message,
      });
    }
  },

  // Store favorite details
  storeFavoriteDetails: async (req, res) => {
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
      const { favoriteId } = req.params;
      const { details } = req.body;

      if (!favoriteId || !details) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: favoriteId and details',
        });
      }

      const success = await cache.storeFavoriteDetails(favoriteId, details);

      if (success) {
        res.json({
          success: true,
          message: 'Favorite details stored successfully',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to store favorite details',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to store favorite details',
        message: error.message,
      });
    }
  },

  // Get favorite screenshots
  getFavoriteScreenshots: async (req, res) => {
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
      const { favoriteId } = req.params;

      if (!favoriteId) {
        return res.status(400).json({
          success: false,
          error: 'Missing favoriteId parameter',
        });
      }

      const screenshots = await cache.getFavoriteScreenshots(favoriteId);

      if (screenshots) {
        res.json({
          success: true,
          screenshots,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Screenshots not found',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get favorite screenshots',
        message: error.message,
      });
    }
  },

  // Store favorite screenshots
  storeFavoriteScreenshots: async (req, res) => {
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
      const { favoriteId } = req.params;
      const { screenshots } = req.body;

      if (!favoriteId || !screenshots) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: favoriteId and screenshots',
        });
      }

      const success = await cache.storeFavoriteScreenshots(
        favoriteId,
        screenshots
      );

      if (success) {
        res.json({
          success: true,
          message: 'Screenshots stored successfully',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to store screenshots',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to store screenshots',
        message: error.message,
      });
    }
  },

  // Check if torrent is in favorites
  checkFavorite: async (req, res) => {
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
      const { torrent } = req.body;

      if (!torrent) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: torrent',
        });
      }

      const isFavorite = await cache.isFavorite(torrent);

      res.json({
        success: true,
        isFavorite,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to check favorite status',
        message: error.message,
      });
    }
  },

  // Store favorite entry with additional metadata
  storeFavoriteEntry: async (req, res) => {
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
      const { favoriteId, entryData } = req.body;

      if (!favoriteId || !entryData) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: favoriteId and entryData',
        });
      }

      const success = await cache.storeFavoriteEntry(favoriteId, entryData);

      if (success) {
        res.json({
          success: true,
          message: 'Favorite entry stored successfully',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to store favorite entry',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to store favorite entry',
        message: error.message,
      });
    }
  },
};

// Export individual controller functions for direct route binding
module.exports = {
  addFavorite: favoritesController.addFavorite,
  getFavorites: favoritesController.getFavorites,
  removeFavorite: favoritesController.removeFavorite,
  getFavoriteDetails: favoritesController.getFavoriteDetails,
  storeFavoriteDetails: favoritesController.storeFavoriteDetails,
  getFavoriteScreenshots: favoritesController.getFavoriteScreenshots,
  storeFavoriteScreenshots: favoritesController.storeFavoriteScreenshots,
  checkFavorite: favoritesController.checkFavorite,
  storeFavoriteEntry: favoritesController.storeFavoriteEntry,
};
