const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');

async function resolveFavoriteUserIds(cache, userId) {
  const ids = new Set([userId, null]);
  try {
    const user = await cache.authStore?.getUserById(userId);
    if (user?.google_id) {
      ids.add(user.google_id);
    }
  } catch (_) {
    // ignore lookup errors and fall back to the current user id
  }
  return [...ids];
}

// Favorites controller for all favorites-related endpoints
const favoritesController = {
  // Add favorite
  addFavorite: async (req, res) => {
    const cache = req.app.locals.cache;
    if (!cache || !cache.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const { torrent, coverImageUrl } = req.body;

      if (!torrent) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: torrent',
        });
      }

      // If coverImageUrl is provided, try to create/update favorite entry with cover image
      if (coverImageUrl) {
        const favoriteEntry = await cache.getOrCreateFavoriteEntry(
          torrent,
          req.userId
        );
        if (favoriteEntry) {
          await cache.updateFavoriteEntryCoverImage(
            favoriteEntry.id,
            coverImageUrl
          );
        }
      }

      const success = await cache.addFavorite(torrent, req.userId);

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
        error: 'Failed to add favorite',
        message: error.message,
      });
    }
  },

  // Get favorites
  getFavorites: async (req, res) => {
    const cache = req.app.locals.cache;
    if (!cache || !cache.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;
      const favoriteUserIds = await resolveFavoriteUserIds(cache, req.userId);

      // Use optimized database-level pagination and merging
      const [favorites, totalCount] = await Promise.all([
        cache.getMergedFavoritesPaginated(limit, offset, favoriteUserIds),
        cache.getMergedFavoritesCount(favoriteUserIds),
      ]);

      // Enrich favorites with cover images using a single batched lookup
      // (prefers S3 presigned URLs for migrated covers). Avoids the previous
      // N+1 query pattern of one cover lookup per favorite.
      let coverImagesByTorrent = new Map();
      try {
        coverImagesByTorrent = await cache.getCoverImagesForTorrents(favorites);
      } catch (error) {
        console.warn('Failed to batch-load cover images for favorites:', error.message);
      }

      const enrichedFavorites = favorites.map((favorite) => {
        // Drop the internal field surfaced for batch enrichment.
        const { favoriteEntryCoverImageUrl, ...cleanFavorite } = favorite;
        const coverImage = coverImagesByTorrent.get(favorite);
        if (coverImage) {
          return {
            ...cleanFavorite,
            coverImage: {
              type: coverImage.type,
              url: coverImage.imageUrl || coverImage.originalUrl,
              mimeType: coverImage.mimeType,
            },
          };
        }
        return cleanFavorite;
      });

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        success: true,
        favorites: enrichedFavorites,
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
        error: 'Failed to get favorites',
        message: error.message,
      });
    }
  },

  // Remove favorite
  removeFavorite: async (req, res) => {
    const cache = req.app.locals.cache;
    if (!cache || !cache.isInitialized) {
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

      const success = await cache.removeFavorite(
        torrent,
        await resolveFavoriteUserIds(cache, req.userId)
      );

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
        error: 'Failed to remove favorite',
        message: error.message,
      });
    }
  },

  // Get favorite details
  getFavoriteDetails: async (req, res) => {
    const cache = req.app.locals.cache;
    if (!cache || !cache.isInitialized) {
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
        error: 'Failed to get favorite details',
        message: error.message,
      });
    }
  },

  // Store favorite details
  storeFavoriteDetails: async (req, res) => {
    const cache = req.app.locals.cache;
    if (!cache || !cache.isInitialized) {
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
        error: 'Failed to store favorite details',
        message: error.message,
      });
    }
  },

  // Check if torrent is in favorites
  checkFavorite: async (req, res) => {
    const cache = req.app.locals.cache;
    if (!cache || !cache.isInitialized) {
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

      const favoriteUserIds = await resolveFavoriteUserIds(cache, req.userId);
      const isFavorite = await cache.isFavorite(torrent, favoriteUserIds);
      const favoriteEntry = isFavorite
        ? await cache.getFavoriteEntry(torrent, favoriteUserIds)
        : null;

      res.json({
        success: true,
        isFavorite,
        favoriteEntry,
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
        error: 'Failed to check favorite status',
        message: error.message,
      });
    }
  },

  // Store favorite entry with additional metadata
  storeFavoriteEntry: async (req, res) => {
    const cache = req.app.locals.cache;
    if (!cache || !cache.isInitialized) {
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
  checkFavorite: favoritesController.checkFavorite,
  storeFavoriteEntry: favoritesController.storeFavoriteEntry,
};
