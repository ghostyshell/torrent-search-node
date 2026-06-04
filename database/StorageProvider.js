const TursoClient = require('./TursoClient');
const MongoClient = require('./MongoClient');
const MongoAuthStore = require('./MongoAuthStore');
const { config } = require('../config/environment');
const CacheRepository = require('./repositories/CacheRepository');
const ImageRepository = require('./repositories/ImageRepository');
const StreamUrlRepository = require('./repositories/StreamUrlRepository');
const FavoriteRepository = require('./repositories/FavoriteRepository');
const CachedLinkRepository = require('./repositories/CachedLinkRepository');
const TorrentDetailsRepository = require('./repositories/TorrentDetailsRepository');
const SearchQueryRepository = require('./repositories/SearchQueryRepository');
const mongoRepos = require('./repositories/mongoRepositories');
const logger = require('../middleware/logger');

/**
 * StorageProvider - Central coordinator for all data repositories
 * Provides a clean interface for application data operations
 * Uses Turso as the persistent storage backend
 */
class StorageProvider {
  constructor(cfg = {}) {
    this.tursoClient = new TursoClient(cfg);
    this.mongoClient = null;     // set when a Mongo URI is configured
    this.authStore = null;       // MongoAuthStore when routing auth to Mongo, else null (passport uses Turso SQL)
    this.activeBackend = 'turso';
    this.isInitialized = false;

    // Initialize repositories
    this.cache = null;
    this.images = null;
    this.streamUrls = null;
    this.favorites = null;
    this.cachedLinks = null;
    this.torrentDetails = null;
    this.searchQueries = null;
  }

  /**
   * Initialize the storage system and all repositories.
   *
   * Always connects Turso. If a Mongo URI is configured, also connects Mongo
   * (non-fatal) so the migration task works. When EXPERIMENT_MONGODB is on AND
   * Mongo connected, reads/writes route to the Mongo repositories (which mirror
   * every write back into Turso); otherwise the Turso repositories are used.
   */
  async initialize() {
    if (this.isInitialized) return this;

    // Connect Mongo first when a URI is configured (also needed for the
    // migration task even while still on Turso).
    if (config.database.mongo.uri) {
      this.mongoClient = new MongoClient({
        uri: config.database.mongo.uri,
        dbName: config.database.mongo.dbName,
      });
      try {
        await this.mongoClient.initializeConnection();
        logger.info('[storage] MongoDB connected', { db: config.database.mongo.dbName });
      } catch (err) {
        logger.error('[storage] MongoDB connection failed', { error: err.message });
        // keep the (unconnected) client so the dashboard can report status
      }
    }

    const useMongo =
      config.database.mongo.experiment && this.mongoClient && this.mongoClient.isConnected;

    if (useMongo) {
      // ── MONGO-ONLY MODE ──────────────────────────────────────────────────
      // Turso is intentionally NOT connected and writes are NOT mirrored — this
      // is the dry-run for removing Turso entirely. To restore Turso (with the
      // dual-write mirror), flip EXPERIMENT_MONGODB off and restart.
      //
      // NOTE: while in this mode Turso is no longer kept in sync, so it will be
      // stale if you roll back. We're validating before deleting Turso for good.
      const noopMirror = {
        upsert: async () => {},
        delete: async () => {},
        run: async () => {},
      };
      this.cache = new mongoRepos.MongoCacheRepository(this.mongoClient, noopMirror);
      this.images = new mongoRepos.MongoImageRepository(this.mongoClient, noopMirror);
      this.streamUrls = new mongoRepos.MongoStreamUrlRepository(this.mongoClient, noopMirror);
      this.favorites = new mongoRepos.MongoFavoriteRepository(this.mongoClient, noopMirror);
      this.cachedLinks = new mongoRepos.MongoCachedLinkRepository(this.mongoClient, noopMirror);
      this.torrentDetails = new mongoRepos.MongoTorrentDetailsRepository(this.mongoClient, noopMirror);
      this.searchQueries = new mongoRepos.MongoSearchQueryRepository(this.mongoClient, noopMirror);
      this.authStore = new MongoAuthStore(this.mongoClient, noopMirror);
      this.activeBackend = 'mongo';
      logger.info('[storage] MONGO-ONLY mode active — Turso is disabled (not connected, no dual-write)');
    } else {
      if (config.database.mongo.experiment) {
        logger.warn('[storage] EXPERIMENT_MONGODB set but MongoDB unavailable — using Turso');
      }
      // ── TURSO MODE (legacy path; only connect Turso here) ─────────────────
      await this.tursoClient.initializeConnection();
      this.cache = new CacheRepository(this.tursoClient);
      this.images = new ImageRepository(this.tursoClient);
      this.streamUrls = new StreamUrlRepository(this.tursoClient);
      this.favorites = new FavoriteRepository(this.tursoClient);
      this.cachedLinks = new CachedLinkRepository(this.tursoClient);
      this.torrentDetails = new TorrentDetailsRepository(this.tursoClient);
      this.searchQueries = new SearchQueryRepository(this.tursoClient);
      this.authStore = null;
      this.activeBackend = 'turso';
    }

    this.isInitialized = true;
    return this;
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use initialize() instead
   */
  async initializeDatabase() {
    return this.initialize();
  }

  /**
   * Set cover image for a torrent with coordination across repositories
   * This method handles the complex logic of updating multiple tables
   */
  async setCoverImage(torrent, imageUrl, imageData = null) {
    try {
      // Store in images repository (uploads to S3 object storage)
      return await this.images.setCoverImage(torrent, imageUrl, imageData);
    } catch (error) {
      console.error(
        `❌ [StorageManager] Error setting cover image for ${torrent.Name}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Get cover image for a torrent, checking all possible sources
   */
  async getCoverImageForTorrent(torrent) {
    const torrentKey = this.images.generateTorrentKey(torrent);

    // First check images repository
    const coverImage = await this.images.getCoverImageByKey(torrentKey);
    if (coverImage) {
      return coverImage;
    }

    // Check favorite entry
    let favoriteEntry = null;

    if (torrent.favoriteEntryId) {
      favoriteEntry = await this.favorites.getFavoriteEntryById(torrent.favoriteEntryId);
    } else {
      favoriteEntry = await this.favorites.getFavoriteEntry(torrent);
    }

    if (favoriteEntry && favoriteEntry.coverImageUrl) {
      return {
        type: 'url',
        imageUrl: favoriteEntry.coverImageUrl,
        originalUrl: favoriteEntry.coverImageUrl,
      };
    }

    // Check cached link
    if (torrent.isCachedLink && torrent.cachedLinkId) {
      const cachedLink = await this.cachedLinks.getCachedLinkById(torrent.cachedLinkId);
      if (cachedLink && cachedLink.coverImageUrl) {
        return {
          type: 'url',
          imageUrl: cachedLink.coverImageUrl,
          originalUrl: cachedLink.coverImageUrl,
        };
      }
    }

    return null;
  }

  /**
   * Batch-resolve cover images for a page of torrents/favorites, avoiding the
   * per-row N+1 query pattern. Mirrors getCoverImageForTorrent's source
   * priority: images table -> favorite entry cover -> cached link cover.
   * @param {Array} torrents - Torrent/favorite objects (as returned by getMergedFavorites)
   * @returns {Promise<Map<object, object>>} Map keyed by the torrent object -> cover image
   */
  async getCoverImagesForTorrents(torrents) {
    const result = new Map();
    if (!Array.isArray(torrents) || torrents.length === 0) {
      return result;
    }

    // 1. Single batched lookup against the images table by torrent_key.
    const keyByTorrent = new Map();
    const torrentKeys = [];
    for (const torrent of torrents) {
      const key = this.images.generateTorrentKey(torrent);
      keyByTorrent.set(torrent, key);
      torrentKeys.push(key);
    }
    const imagesByKey = await this.images.getCoverImagesByKeys(torrentKeys);

    // 2. Resolve each torrent, falling back to the favorite-entry cover (already
    //    surfaced on the object) and finally to cached-link covers.
    const pendingCachedLinks = [];
    for (const torrent of torrents) {
      const key = keyByTorrent.get(torrent);
      const fromImages = imagesByKey.get(key);
      if (fromImages) {
        result.set(torrent, fromImages);
        continue;
      }

      if (torrent.favoriteEntryCoverImageUrl) {
        result.set(torrent, {
          type: 'url',
          imageUrl: torrent.favoriteEntryCoverImageUrl,
          originalUrl: torrent.favoriteEntryCoverImageUrl,
        });
        continue;
      }

      if (torrent.isCachedLink && torrent.cachedLinkId) {
        pendingCachedLinks.push(torrent);
      }
    }

    // 3. Cached-link covers are a small subset; resolve them concurrently.
    await Promise.all(
      pendingCachedLinks.map(async (torrent) => {
        try {
          const cachedLink = await this.cachedLinks.getCachedLinkById(
            torrent.cachedLinkId
          );
          if (cachedLink && cachedLink.coverImageUrl) {
            result.set(torrent, {
              type: 'url',
              imageUrl: cachedLink.coverImageUrl,
              originalUrl: cachedLink.coverImageUrl,
            });
          }
        } catch (error) {
          // Ignore individual cached-link lookup failures.
        }
      })
    );

    return result;
  }

  /**
   * Cleanup old data across all repositories
   */
  async cleanup() {
    await this.cache.cleanupExpired();
    return this.getStats();
  }

  /**
   * Get comprehensive statistics across all repositories
   */
  async getStats() {
    const stats = this.activeBackend === 'mongo' && this.mongoClient
      ? await this.mongoClient.getStats()
      : await this.tursoClient.getStats();

    return {
      ...stats,
      databaseType: this.activeBackend === 'mongo' ? 'MongoDB' : 'Turso Cloud',
      activeBackend: this.activeBackend,
      environment: this.tursoClient.config.environment,
    };
  }

  /**
   * Health check for the storage system
   */
  async healthCheck() {
    if (this.activeBackend === 'mongo' && this.mongoClient) {
      return this.mongoClient.healthCheck();
    }
    return this.tursoClient.healthCheck();
  }

  /**
   * Close all database connections
   */
  async close() {
    if (this.mongoClient) {
      try { await this.mongoClient.close(); } catch (_) { /* ignore */ }
    }
    return this.tursoClient.close();
  }

  // Legacy compatibility methods - these forward to the appropriate repositories

  /**
   * @deprecated Use cache.set() instead
   */
  async set(key, value, ttlSeconds = null, type = 'json', metadata = null) {
    return this.cache.set(key, value, ttlSeconds, type, metadata);
  }

  /**
   * @deprecated Use cache.get() instead
   */
  async get(key, defaultValue = null) {
    return this.cache.get(key, defaultValue);
  }

  /**
   * @deprecated Use cache.delete() instead
   */
  async delete(key) {
    return this.cache.delete(key);
  }

  /**
   * @deprecated Use images.getCoverImage() instead
   */
  async getCoverImage(torrent) {
    return this.images.getCoverImage(torrent);
  }

  /**
   * @deprecated Use images.getCoverImageByKey() instead
   */
  async getCoverImageByKey(torrentKey) {
    return this.images.getCoverImageByKey(torrentKey);
  }

  /**
   * @deprecated Use images.hasCoverImage() instead
   */
  async hasCoverImage(torrent) {
    return this.images.hasCoverImage(torrent);
  }

  /**
   * @deprecated Use streamUrls.setStreamUrl() instead
   */
  async setStreamUrl(magnetLink, streamData) {
    return this.streamUrls.setStreamUrl(magnetLink, streamData);
  }

  /**
   * @deprecated Use streamUrls.getStreamUrl() instead
   */
  async getStreamUrl(magnetLink) {
    return this.streamUrls.getStreamUrl(magnetLink);
  }

  /**
   * @deprecated Use streamUrls.getStreamUrlByHash() instead
   */
  async getStreamUrlByHash(magnetHash) {
    return this.streamUrls.getStreamUrlByHash(magnetHash);
  }

  /**
   * @deprecated Use streamUrls.hasStreamUrl() instead
   */
  async hasStreamUrl(magnetLink) {
    return this.streamUrls.hasStreamUrl(magnetLink);
  }

  /**
   * @deprecated Use streamUrls.cleanupOldStreamUrls() instead
   */
  async cleanupOldStreamUrls(maxEntries = 100) {
    return this.streamUrls.cleanupOldStreamUrls(maxEntries);
  }

  /**
   * @deprecated Use favorites.addFavorite() instead
   */
  async addFavorite(torrent, userId = null) {
    return this.favorites.addFavorite(torrent, userId);
  }

  /**
   * @deprecated Use favorites.removeFavorite() instead
   */
  async removeFavorite(torrent, userId = null) {
    return this.favorites.removeFavorite(torrent, userId);
  }

  /**
   * @deprecated Use favorites.isFavorite() instead
   */
  async isFavorite(torrent, userId = null) {
    return this.favorites.isFavorite(torrent, userId);
  }

  /**
   * @deprecated Use cachedLinks.addCachedLink() instead
   */
  async addCachedLink(cachedLink, userId = null) {
    return this.cachedLinks.addCachedLink(cachedLink, userId);
  }

  /**
   * @deprecated Use cachedLinks.removeCachedLink() instead
   */
  async removeCachedLink(id, userId = null) {
    return this.cachedLinks.removeCachedLink(id, userId);
  }

  /**
   * @deprecated Use cachedLinks.getCachedLinks() instead
   */
  async getCachedLinks(page = 1, limit = 20, userId = null) {
    return this.cachedLinks.getCachedLinks(page, limit, userId);
  }

  /**
   * @deprecated Use cachedLinks.updateCachedLink() instead
   */
  async updateCachedLink(id, updates, userId = null) {
    return this.cachedLinks.updateCachedLink(id, updates, userId);
  }

  /**
   * @deprecated Use favorites.createFavoriteEntry() instead
   */
  async createFavoriteEntry(torrent, coverImageUrl = null, userId = null) {
    return this.favorites.createFavoriteEntry(torrent, coverImageUrl, userId);
  }

  /**
   * @deprecated Use favorites.getFavoriteEntry() instead
   */
  async getFavoriteEntry(torrent, userId = null) {
    return this.favorites.getFavoriteEntry(torrent, userId);
  }

  /**
   * @deprecated Use favorites.getFavoriteEntryById() instead
   */
  async getFavoriteEntryById(favoriteId) {
    return this.favorites.getFavoriteEntryById(favoriteId);
  }

  /**
   * Get favorite details by ID, enriched with cover image from images table
   * @param {string} favoriteId - Favorite entry ID
   * @returns {Promise<object|null>} Favorite details with cover image
   */
  async getFavoriteDetails(favoriteId) {
    const favoriteEntry = await this.favorites.getFavoriteEntryById(favoriteId);
    if (!favoriteEntry) return null;

    // Build torrent object from favorite entry
    const torrent = {
      ...favoriteEntry.torrentData,
      favoriteEntryId: favoriteEntry.id,
    };

    // Get cover image from images table (prefers S3 presigned URLs for migrated covers)
    const coverImage = await this.getCoverImageForTorrent(torrent);

    return {
      ...favoriteEntry,
      coverImage: coverImage ? {
        type: coverImage.type,
        url: coverImage.imageUrl || coverImage.originalUrl,
        mimeType: coverImage.mimeType,
      } : null,
    };
  }

  /**
   * @deprecated Use favorites.getAllFavoriteEntries() instead
   */
  async getAllFavoriteEntries() {
    const entries = await this.favorites.getFavoriteEntries(1000, 0);
    return entries;
  }

  /**
   * @deprecated Use favorites.getFavoriteEntries() instead
   */
  async getFavoriteEntriesPaginated(limit, offset) {
    return this.favorites.getFavoriteEntries(limit, offset);
  }

  /**
   * @deprecated Use favorites.getStats() instead
   */
  async getFavoritesCount() {
    const stats = await this.favorites.getStats();
    return stats.total;
  }

  /**
   * @deprecated Use favorites.getMergedFavorites() instead
   */
  async getMergedFavoritesPaginated(limit, offset, userId = null) {
    return this.favorites.getMergedFavorites(limit, offset, userId);
  }

  /**
   * @deprecated Use favorites.getMergedFavoritesCount() instead
   */
  async getMergedFavoritesCount(userId = null) {
    return this.favorites.getMergedFavoritesCount(userId);
  }

  /**
   * @deprecated Use favorites.getFavoriteEntryByKey() instead
   */
  async getFavoriteEntryByKey(torrentKey) {
    return this.favorites.getFavoriteEntryByKey(torrentKey);
  }

  /**
   * @deprecated Use favorites.removeFavoriteEntry() instead
   */
  async removeFavoriteEntry(favoriteId) {
    return this.favorites.removeFavoriteEntry(favoriteId);
  }

  /**
   * @deprecated Use torrentDetails.setTorrentDetails() instead
   */
  async setTorrentDetails(favoriteId, source, detailsData) {
    return this.torrentDetails.setTorrentDetails(favoriteId, source, detailsData);
  }

  /**
   * @deprecated Use torrentDetails.getTorrentDetails() instead
   */
  async getTorrentDetails(favoriteId, source = null) {
    return this.torrentDetails.getTorrentDetails(favoriteId, source);
  }

  /**
   * @deprecated Use torrentDetails.removeTorrentDetails() instead
   */
  async removeTorrentDetails(favoriteId, source = null) {
    return this.torrentDetails.removeTorrentDetails(favoriteId, source);
  }

  /**
   * @deprecated Use favorites.getOrCreateFavoriteEntry() instead
   */
  async getOrCreateFavoriteEntry(torrent, userId = null) {
    return this.favorites.getOrCreateFavoriteEntry(torrent, userId);
  }

  /**
   * @deprecated Use images.generateTorrentKey() instead
   */
  generateTorrentKey(torrent) {
    return this.images.generateTorrentKey(torrent);
  }

  /**
   * @deprecated Use streamUrls.extractMagnetHash() instead
   */
  extractMagnetHash(magnetLink) {
    return this.streamUrls.extractMagnetHash(magnetLink);
  }

  /**
   * @deprecated Use images.detectMimeType() instead
   */
  detectMimeType(buffer) {
    return this.images.detectMimeType(buffer);
  }

  /**
   * @deprecated Use favorites.updateCoverImage() instead
   */
  async updateFavoriteEntryCoverImage(favoriteId, coverImageUrl) {
    return this.favorites.updateCoverImage(favoriteId, coverImageUrl);
  }

  /**
   * Update magnet link for favorite entry
   */
  async updateFavoriteEntryMagnetLink(favoriteId, magnetLink) {
    return this.favorites.updateMagnetLinkAndData(favoriteId, magnetLink);
  }

  /**
   * @deprecated Use torrentDetails.updateCoverImage() instead
   */
  async updateTorrentDetailsCoverImage(favoriteId, source, coverImageUrl) {
    return this.torrentDetails.updateCoverImage(favoriteId, source, coverImageUrl);
  }

  /**
   * @deprecated Use cachedLinks.updateCoverImage() instead
   */
  async updateCachedLinkCoverImage(cachedLinkId, coverImageUrl) {
    return this.cachedLinks.updateCoverImage(cachedLinkId, coverImageUrl);
  }

  /**
   * @deprecated Use cleanup() instead
   */
  async printStats() {
    const stats = await this.getStats();
    console.log('Storage Statistics:', stats);
  }
}

module.exports = StorageProvider;
