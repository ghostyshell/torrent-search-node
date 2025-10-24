const DatabaseManager = require('./DatabaseManager');
const pixhostService = require('../services/pixhostService');

/**
 * Unified cache manager that works with both local SQLite and Turso cloud database
 * Maintains compatibility with existing SQLiteCache interface while adding cloud support
 */
class UnifiedCache {
  constructor(config = {}) {
    this.dbManager = new DatabaseManager(config);
    this.isInitialized = false;
  }

  /**
   * Initialize the cache system
   */
  async initializeDatabase() {
    if (!this.isInitialized) {
      await this.dbManager.initializeConnection();
      this.isInitialized = true;
    }
    return this;
  }

  // === GENERAL CACHE METHODS ===

  async set(key, value, ttlSeconds = null, type = 'json', metadata = null) {
    const expiresAt = ttlSeconds
      ? Math.floor(Date.now() / 1000) + ttlSeconds
      : null;
    const valueStr = type === 'json' ? JSON.stringify(value) : value;
    const metadataStr = metadata ? JSON.stringify(metadata) : null;

    const sql = `
      INSERT OR REPLACE INTO cache (key, value, type, expires_at, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;

    const result = await this.dbManager.run(sql, [
      key,
      valueStr,
      type,
      expiresAt,
      metadataStr,
    ]);
    return result.changes > 0;
  }

  async get(key, defaultValue = null) {
    const sql = `
      SELECT value, type, expires_at FROM cache 
      WHERE key = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
    `;

    const row = await this.dbManager.get(sql, [key]);

    if (!row) {
      return defaultValue;
    }

    try {
      const value = row.type === 'json' ? JSON.parse(row.value) : row.value;
      return value;
    } catch (parseErr) {
      return defaultValue;
    }
  }

  async delete(key) {
    const result = await this.dbManager.run('DELETE FROM cache WHERE key = ?', [
      key,
    ]);
    return result.changes > 0;
  }

  // === COVER IMAGE METHODS ===

  async setCoverImage(torrent, imageUrl, imageData = null) {
    const torrentKey = this.generateTorrentKey(torrent);

    try {
      let pixhostUrl = imageUrl;

      // Always upload to Pixhost if we have an image URL (not already a Pixhost URL)
      if (
        imageUrl &&
        !imageUrl.includes('pixhost.to') &&
        !imageUrl.includes('img1.pixhost.to')
      ) {
        try {
          const uploadResult = await pixhostService.uploadFromUrl(imageUrl);
          pixhostUrl = uploadResult.directImageUrl;
        } catch (uploadError) {
          console.warn(
            `⚠️ [UnifiedCache] Pixhost upload failed, using original URL:`,
            uploadError.message
          );
          // Continue with original URL if Pixhost upload fails
        }
      }

      // Store the Pixhost URL in the images table
      const sql = `
        INSERT OR REPLACE INTO images (torrent_key, image_type, pixhost_url, original_url, torrent_name)
        VALUES (?, 'cover', ?, ?, ?)
      `;

      const result = await this.dbManager.run(sql, [
        torrentKey,
        pixhostUrl,
        imageUrl, // Original URL for reference
        torrent.Name || 'Unknown',
      ]);

      let success = result.changes > 0;

      if (success) {
      } else {
        console.warn(
          `❌ [UnifiedCache] Failed to store cover image in images table for: ${torrent.Name}`
        );
      }

      // Additionally store cover image in specific tables for favorites and cached links
      let additionalStorageSuccess = true;

      // If this is a cached link, store in cached_links table
      if (torrent.isCachedLink && torrent.cachedLinkId) {
        try {
          const cachedLinkSuccess = await this.updateCachedLinkCoverImage(
            torrent.cachedLinkId,
            pixhostUrl
          );
          if (cachedLinkSuccess) {
          } else {
            console.warn(
              `⚠️ [UnifiedCache] Failed to store cover image in cached_links table for: ${torrent.Name}`
            );
            additionalStorageSuccess = false;
          }
        } catch (error) {
          console.error(
            `❌ [UnifiedCache] Error storing cover image in cached_links table:`,
            error.message
          );
          additionalStorageSuccess = false;
        }
      }

      // If this torrent has a favoriteEntryId, store in favorite_entries table
      if (torrent.favoriteEntryId) {
        try {
          const favoriteSuccess = await this.updateFavoriteEntryCoverImage(
            torrent.favoriteEntryId,
            pixhostUrl
          );
          if (favoriteSuccess) {
          } else {
            console.warn(
              `⚠️ [UnifiedCache] Failed to store cover image in favorite_entries table for: ${torrent.Name}`
            );
            additionalStorageSuccess = false;
          }
        } catch (error) {
          console.error(
            `❌ [UnifiedCache] Error storing cover image in favorite_entries table:`,
            error.message
          );
          additionalStorageSuccess = false;
        }
      }

      // If this is a favorite but we don't have favoriteEntryId, try to find it
      if (!torrent.favoriteEntryId && !torrent.isCachedLink) {
        try {
          const favoriteEntry = await this.getOrCreateFavoriteEntry(torrent);
          if (favoriteEntry && favoriteEntry.id) {
            const favoriteSuccess = await this.updateFavoriteEntryCoverImage(
              favoriteEntry.id,
              pixhostUrl
            );
            if (favoriteSuccess) {
            } else {
              console.warn(
                `⚠️ [UnifiedCache] Failed to store cover image in favorite_entries table (auto-detected) for: ${torrent.Name}`
              );
            }
          }
        } catch (error) {
          // This is not an error - just means this torrent is not a favorite
        }
      }

      return success;
    } catch (error) {
      console.error(
        `❌ [UnifiedCache] Error setting cover image for ${torrent.Name}:`,
        error.message
      );
      return false;
    }
  }

  async storeCoverImage(torrent, imageData, mimeType) {
    const torrentKey = this.generateTorrentKey(torrent);

    const sql = `
      INSERT OR REPLACE INTO images (torrent_key, image_type, image_data, torrent_name, mime_type)
      VALUES (?, 'cover', ?, ?, ?)
    `;

    const result = await this.dbManager.run(sql, [
      torrentKey,
      imageData,
      torrent.Name || 'Unknown',
      mimeType || this.detectMimeType(imageData),
    ]);

    return result.changes > 0;
  }

  async storeCoverImageUrl(torrent, imageUrl) {
    const torrentKey = this.generateTorrentKey(torrent);

    return await this.set(
      `cover_url_${torrentKey}`,
      {
        imageUrl,
        torrentName: torrent.Name,
        originalUrl: imageUrl,
      },
      null,
      'json',
      { type: 'cover_image' }
    );
  }

  async getCoverImage(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);

    // Get Pixhost URL from images table
    const sql = `
      SELECT pixhost_url, original_url FROM images
      WHERE torrent_key = ? AND image_type = 'cover'
    `;

    const row = await this.dbManager.get(sql, [torrentKey]);

    if (row && row.pixhost_url) {
      return {
        type: 'url',
        imageUrl: row.pixhost_url,
        originalUrl: row.original_url || row.pixhost_url,
      };
    }

    return null;
  }

  async getCoverImageByKey(torrentKey) {
    // Check URL storage in images table (Pixhost URLs)
    const urlSql = `
      SELECT pixhost_url, original_url FROM images
      WHERE torrent_key = ? AND image_type = 'cover'
    `;

    const row = await this.dbManager.get(urlSql, [torrentKey]);

    if (row) {
      return {
        type: 'url',
        imageUrl: row.pixhost_url,
        originalUrl: row.original_url || row.pixhost_url,
      };
    }

    // Fallback to legacy URL cache
    try {
      const urlData = await this.get(`cover_url_${torrentKey}`);
      if (urlData) {
        return { ...urlData, type: 'url' };
      }
    } catch (urlErr) {
      // Ignore URL cache errors
    }

    return null;
  }

  async hasCoverImage(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);

    // Check URL storage in images table
    const urlSql =
      'SELECT 1 FROM images WHERE torrent_key = ? AND image_type = ? AND pixhost_url IS NOT NULL';
    const urlRow = await this.dbManager.get(urlSql, [torrentKey, 'cover']);

    if (urlRow) {
      return true;
    }

    // Check legacy URL cache
    const legacySql = `
      SELECT 1 FROM cache WHERE key = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
    `;
    const legacyRow = await this.dbManager.get(legacySql, [
      `cover_url_${torrentKey}`,
    ]);

    return !!legacyRow;
  }

  // === STREAM URL METHODS ===

  async setStreamUrl(magnetLink, streamData) {
    const magnetHash = this.extractMagnetHash(magnetLink);

    const sql = `
      INSERT OR REPLACE INTO stream_urls 
      (magnet_hash, stream_url, filename, filesize, supports_range_requests, torrent_name, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;

    const result = await this.dbManager.run(sql, [
      magnetHash,
      streamData.streamUrl,
      streamData.filename || null,
      streamData.filesize || null,
      streamData.supportsRangeRequests ? 1 : 0,
      streamData.torrentName || null,
    ]);

    return result.changes > 0;
  }

  async getStreamUrl(magnetLink) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    const sql = 'SELECT * FROM stream_urls WHERE magnet_hash = ?';
    const row = await this.dbManager.get(sql, [magnetHash]);

    if (row) {
      // Update last accessed time
      const updateSql = `
        UPDATE stream_urls SET last_accessed_at = strftime('%s', 'now') WHERE magnet_hash = ?
      `;
      await this.dbManager.run(updateSql, [magnetHash]);

      return {
        streamUrl: row.stream_url,
        filename: row.filename,
        filesize: row.filesize,
        supportsRangeRequests: !!row.supports_range_requests,
        cachedAt: row.created_at,
        lastAccessed: row.last_accessed_at,
      };
    }

    return null;
  }

  async getStreamUrlByHash(magnetHash) {
    const sql = 'SELECT * FROM stream_urls WHERE magnet_hash = ?';
    const row = await this.dbManager.get(sql, [magnetHash]);

    if (row) {
      // Update last_accessed_at
      await this.dbManager.run(
        'UPDATE stream_urls SET last_accessed_at = strftime("%s", "now") WHERE magnet_hash = ?',
        [magnetHash]
      );

      return {
        streamUrl: row.stream_url,
        filename: row.filename,
        filesize: row.filesize,
        supportsRangeRequests: !!row.supports_range_requests,
        cachedAt: row.created_at,
        lastAccessed: row.last_accessed_at,
      };
    }

    return null;
  }

  async hasStreamUrl(magnetLink) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    const sql = 'SELECT 1 FROM stream_urls WHERE magnet_hash = ?';
    const row = await this.dbManager.get(sql, [magnetHash]);
    return !!row;
  }

  async cleanupOldStreamUrls(maxEntries = 100) {
    // First count current entries
    const countRow = await this.dbManager.get(
      'SELECT COUNT(*) as count FROM stream_urls'
    );
    const count = countRow.count;

    if (count <= maxEntries) {
      return 0;
    }

    // Delete oldest entries
    const toDelete = count - maxEntries;
    const deleteSql = `
      DELETE FROM stream_urls WHERE magnet_hash IN (
        SELECT magnet_hash FROM stream_urls 
        ORDER BY last_accessed_at ASC 
        LIMIT ?
      )
    `;

    const result = await this.dbManager.run(deleteSql, [toDelete]);
    return result.changes;
  }

  // === FAVORITES METHODS ===

  async addFavorite(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const sql = `
      INSERT OR REPLACE INTO favorites (torrent_key, torrent_data, user_id)
      VALUES (?, ?, ?)
    `;

    const result = await this.dbManager.run(sql, [
      torrentKey,
      JSON.stringify(torrent),
      userId,
    ]);
    return result.changes > 0;
  }

  async removeFavorite(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const sql = userId
      ? 'DELETE FROM favorites WHERE torrent_key = ? AND user_id = ?'
      : 'DELETE FROM favorites WHERE torrent_key = ? AND user_id IS NULL';
    const params = userId ? [torrentKey, userId] : [torrentKey];

    const result = await this.dbManager.run(sql, params);
    return result.changes > 0;
  }

  async getFavorites(userId = null) {
    const sql = userId
      ? 'SELECT torrent_data, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC'
      : 'SELECT torrent_data, added_at FROM favorites WHERE user_id IS NULL ORDER BY added_at DESC';
    const params = userId ? [userId] : [];
    const rows = await this.dbManager.all(sql, params);

    try {
      return rows.map((row) => ({
        ...JSON.parse(row.torrent_data),
        addedAt: row.added_at,
      }));
    } catch (parseErr) {
      return [];
    }
  }

  async isFavorite(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);

    // Check in both tables for the user's favorites
    const feQuery = userId
      ? 'SELECT 1 FROM favorite_entries WHERE torrent_key = ? AND user_id = ?'
      : 'SELECT 1 FROM favorite_entries WHERE torrent_key = ? AND user_id IS NULL';
    const fQuery = userId
      ? 'SELECT 1 FROM favorites WHERE torrent_key = ? AND user_id = ?'
      : 'SELECT 1 FROM favorites WHERE torrent_key = ? AND user_id IS NULL';

    const params = userId ? [torrentKey, userId] : [torrentKey];

    const [feRow, fRow] = await Promise.all([
      this.dbManager.get(feQuery, params),
      this.dbManager.get(fQuery, params),
    ]);

    return !!(feRow || fRow);
  }

  // === CACHED LINKS METHODS ===

  async addCachedLink(cachedLink, userId = null) {
    const sql = `
      INSERT OR REPLACE INTO cached_links
      (id, url, title, date_added, stream_url, stream_url_cached_at, is_streaming, error, supports_range_requests, filename, cover_image_url, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      cachedLink.id,
      cachedLink.url,
      cachedLink.title,
      cachedLink.dateAdded,
      cachedLink.streamUrl || null,
      cachedLink.streamUrlCachedAt || null,
      cachedLink.isStreaming || 0,
      cachedLink.error || null,
      cachedLink.supportsRangeRequests || 0,
      cachedLink.filename || null,
      cachedLink.coverImageUrl || null,
      userId,
    ];

    const result = await this.dbManager.run(sql, values);

    return result.changes > 0;
  }

  async removeCachedLink(id, userId = null) {
    let sql, params;
    if (userId) {
      // Only allow users to delete their own cached links
      sql = 'DELETE FROM cached_links WHERE id = ? AND user_id = ?';
      params = [id, userId];
    } else {
      // Allow deletion of cached links with no user_id (backwards compatibility)
      sql = 'DELETE FROM cached_links WHERE id = ? AND user_id IS NULL';
      params = [id];
    }

    const result = await this.dbManager.run(sql, params);
    return result.changes > 0;
  }

  async getCachedLinks(page = 1, limit = 20, userId = null) {
    const offset = (page - 1) * limit;

    // Get total count for pagination
    let countSql, countParams;
    if (userId) {
      countSql = 'SELECT COUNT(*) as total FROM cached_links WHERE user_id = ?';
      countParams = [userId];
    } else {
      countSql =
        'SELECT COUNT(*) as total FROM cached_links WHERE user_id IS NULL';
      countParams = [];
    }

    const countResult = await this.dbManager.get(countSql, countParams);
    const totalCount = countResult.total;
    const totalPages = Math.ceil(totalCount / limit);

    let sql, params;
    if (userId) {
      sql = `
        SELECT id, url, title, date_added, stream_url, stream_url_cached_at, is_streaming, error, supports_range_requests, filename, user_id
        FROM cached_links 
        WHERE user_id = ?
        ORDER BY date_added DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, limit, offset];
    } else {
      sql = `
        SELECT id, url, title, date_added, stream_url, stream_url_cached_at, is_streaming, error, supports_range_requests, filename, user_id
        FROM cached_links 
        WHERE user_id IS NULL
        ORDER BY date_added DESC
        LIMIT ? OFFSET ?
      `;
      params = [limit, offset];
    }

    const rows = await this.dbManager.all(sql, params);

    try {
      const cachedLinks = rows.map((row) => ({
        id: row.id,
        url: row.url,
        title: row.title,
        dateAdded: row.date_added,
        streamUrl: row.stream_url,
        streamUrlCachedAt: row.stream_url_cached_at,
        isStreaming: !!row.is_streaming,
        error: row.error,
        supportsRangeRequests: !!row.supports_range_requests,
        filename: row.filename,
        userId: row.user_id,
      }));

      return {
        cachedLinks,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (parseErr) {
      return {
        cachedLinks: [],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };
    }
  }

  async updateCachedLink(id, updates, userId = null) {
    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];

    if (updates.title !== undefined) {
      updateFields.push('title = ?');
      updateValues.push(updates.title);
    }
    if (updates.streamUrl !== undefined) {
      updateFields.push('stream_url = ?');
      updateValues.push(updates.streamUrl);
    }
    if (updates.streamUrlCachedAt !== undefined) {
      updateFields.push('stream_url_cached_at = ?');
      updateValues.push(updates.streamUrlCachedAt);
    }
    if (updates.isStreaming !== undefined) {
      updateFields.push('is_streaming = ?');
      updateValues.push(updates.isStreaming ? 1 : 0);
    }
    if (updates.error !== undefined) {
      updateFields.push('error = ?');
      updateValues.push(updates.error);
    }
    if (updates.supportsRangeRequests !== undefined) {
      updateFields.push('supports_range_requests = ?');
      updateValues.push(updates.supportsRangeRequests ? 1 : 0);
    }
    if (updates.filename !== undefined) {
      updateFields.push('filename = ?');
      updateValues.push(updates.filename);
    }

    if (updateFields.length === 0) {
      return false;
    }

    let sql;
    if (userId) {
      // Only allow users to update their own cached links
      updateValues.push(id, userId);
      sql = `UPDATE cached_links SET ${updateFields.join(
        ', '
      )} WHERE id = ? AND user_id = ?`;
    } else {
      // Allow update of cached links with no user_id (backwards compatibility)
      updateValues.push(id);
      sql = `UPDATE cached_links SET ${updateFields.join(
        ', '
      )} WHERE id = ? AND user_id IS NULL`;
    }

    const result = await this.dbManager.run(sql, updateValues);

    return result.changes > 0;
  }

  // === FAVORITE ENTRIES METHODS (New System) ===

  async createFavoriteEntry(torrent, coverImageUrl = null, userId = null) {
    const { v4: uuidv4 } = require('uuid');
    const favoriteId = uuidv4();
    const torrentKey = this.generateTorrentKey(torrent);

    const sql = `
      INSERT OR REPLACE INTO favorite_entries (id, torrent_key, torrent_data, magnet_link, torrent_name, cover_image_url, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await this.dbManager.run(sql, [
      favoriteId,
      torrentKey,
      JSON.stringify(torrent),
      torrent.MagnetLink || null,
      torrent.Name || 'Unknown',
      coverImageUrl,
      userId,
    ]);

    return result.changes > 0 ? favoriteId : null;
  }

  async getFavoriteEntry(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const sql = userId
      ? 'SELECT * FROM favorite_entries WHERE torrent_key = ? AND user_id = ?'
      : 'SELECT * FROM favorite_entries WHERE torrent_key = ? AND user_id IS NULL';
    const params = userId ? [torrentKey, userId] : [torrentKey];
    const row = await this.dbManager.get(sql, params);

    if (row) {
      return {
        id: row.id,
        torrentKey: row.torrent_key,
        torrentData: JSON.parse(row.torrent_data),
        magnetLink: row.magnet_link,
        torrentName: row.torrent_name,
        coverImageUrl: row.cover_image_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    return null;
  }

  async getFavoriteEntryById(favoriteId) {
    const sql = 'SELECT * FROM favorite_entries WHERE id = ?';
    const row = await this.dbManager.get(sql, [favoriteId]);

    if (row) {
      return {
        id: row.id,
        torrentKey: row.torrent_key,
        torrentData: JSON.parse(row.torrent_data),
        magnetLink: row.magnet_link,
        torrentName: row.torrent_name,
        coverImageUrl: row.cover_image_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    return null;
  }

  async getAllFavoriteEntries() {
    const sql = 'SELECT * FROM favorite_entries ORDER BY created_at DESC';
    const rows = await this.dbManager.all(sql);

    return rows.map((row) => ({
      id: row.id,
      torrentKey: row.torrent_key,
      torrentData: JSON.parse(row.torrent_data),
      magnetLink: row.magnet_link,
      torrentName: row.torrent_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getFavoritesPaginated(limit, offset) {
    const sql = `
      SELECT torrent_data, added_at 
      FROM favorites 
      ORDER BY added_at DESC 
      LIMIT ? OFFSET ?
    `;
    const rows = await this.dbManager.all(sql, [limit, offset]);

    try {
      return rows.map((row) => ({
        ...JSON.parse(row.torrent_data),
        addedAt: row.added_at,
      }));
    } catch (parseErr) {
      return [];
    }
  }

  async getFavoriteEntriesPaginated(limit, offset) {
    const sql = `
      SELECT * 
      FROM favorite_entries 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `;
    const rows = await this.dbManager.all(sql, [limit, offset]);

    return rows.map((row) => ({
      id: row.id,
      torrentKey: row.torrent_key,
      torrentData: JSON.parse(row.torrent_data),
      magnetLink: row.magnet_link,
      torrentName: row.torrent_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getFavoritesCount() {
    const [oldCount, newCount] = await Promise.all([
      this.dbManager.get('SELECT COUNT(*) as count FROM favorites'),
      this.dbManager.get('SELECT COUNT(*) as count FROM favorite_entries'),
    ]);

    return (oldCount?.count || 0) + (newCount?.count || 0);
  }

  async getMergedFavoritesPaginated(limit, offset, userId = null) {
    // Use a UNION query to merge both tables and handle deduplication efficiently at database level
    const userFilter = userId ? 'WHERE user_id = ?' : 'WHERE user_id IS NULL';
    const userFilterFe = userId
      ? 'WHERE fe.user_id = ?'
      : 'WHERE fe.user_id IS NULL';
    const userFilterF = userId ? 'AND f.user_id = ?' : 'AND f.user_id IS NULL';

    const sql = `
      WITH merged_favorites AS (
        -- New favorite entries (these take precedence)
        SELECT 
          torrent_key,
          torrent_data,
          created_at as sort_date,
          id as favorite_entry_id,
          NULL as old_added_at
        FROM favorite_entries
        ${userFilter}
        
        UNION
        
        -- Old favorites (only include if torrent_key doesn't exist in favorite_entries)
        SELECT 
          torrent_key,
          torrent_data,
          added_at as sort_date,
          NULL as favorite_entry_id,
          added_at as old_added_at
        FROM favorites f
        WHERE NOT EXISTS (
          SELECT 1 FROM favorite_entries fe 
          WHERE fe.torrent_key = f.torrent_key ${
            userId
              ? 'AND fe.user_id = f.user_id'
              : 'AND fe.user_id IS NULL AND f.user_id IS NULL'
          }
        )
        ${userFilterF}
      )
      SELECT * FROM merged_favorites
      ORDER BY sort_date DESC
      LIMIT ? OFFSET ?
    `;

    const params = userId ? [userId, userId, limit, offset] : [limit, offset];
    const rows = await this.dbManager.all(sql, params);

    return rows
      .map((row) => {
        try {
          const torrentData = JSON.parse(row.torrent_data);
          return {
            ...torrentData,
            favoriteEntryId: row.favorite_entry_id,
            dateAdded: new Date(row.sort_date * 1000).toISOString(),
          };
        } catch (parseErr) {
          return null;
        }
      })
      .filter(Boolean);
  }

  async getMergedFavoritesCount(userId = null) {
    // Get accurate count using same deduplication logic
    const userFilterFe = userId ? 'WHERE user_id = ?' : 'WHERE user_id IS NULL';
    const userFilterF = userId ? 'AND f.user_id = ?' : 'AND f.user_id IS NULL';

    const sql = `
      WITH merged_favorites AS (
        -- New favorite entries (these take precedence)
        SELECT torrent_key FROM favorite_entries
        ${userFilterFe}
        
        UNION
        
        -- Old favorites (only include if torrent_key doesn't exist in favorite_entries)
        SELECT torrent_key FROM favorites f
        WHERE NOT EXISTS (
          SELECT 1 FROM favorite_entries fe 
          WHERE fe.torrent_key = f.torrent_key ${
            userId
              ? 'AND fe.user_id = f.user_id'
              : 'AND fe.user_id IS NULL AND f.user_id IS NULL'
          }
        )
        ${userFilterF}
      )
      SELECT COUNT(*) as count FROM merged_favorites
    `;

    const params = userId ? [userId, userId] : [];
    const result = await this.dbManager.get(sql, params);
    return result?.count || 0;
  }

  async getFavoriteEntryByKey(torrentKey) {
    // First check favorite_entries (new system)
    let sql = 'SELECT * FROM favorite_entries WHERE torrent_key = ?';
    let row = await this.dbManager.get(sql, [torrentKey]);

    if (row) {
      return {
        id: row.id,
        torrentKey: row.torrent_key,
        torrentData: JSON.parse(row.torrent_data),
        magnetLink: row.magnet_link,
        torrentName: row.torrent_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    // Fall back to old favorites system
    sql = 'SELECT torrent_data, added_at FROM favorites WHERE torrent_key = ?';
    row = await this.dbManager.get(sql, [torrentKey]);

    if (row) {
      try {
        return {
          id: null, // No ID for old favorites
          torrentKey: torrentKey,
          torrentData: JSON.parse(row.torrent_data),
          magnetLink: null,
          torrentName: null,
          createdAt: row.added_at,
          updatedAt: row.added_at,
        };
      } catch (parseErr) {
        return null;
      }
    }

    return null;
  }

  async removeFavoriteEntry(favoriteId) {
    const sql = 'DELETE FROM favorite_entries WHERE id = ?';
    const result = await this.dbManager.run(sql, [favoriteId]);
    return result.changes > 0;
  }

  // === TORRENT DETAILS METHODS (New System) ===

  async setTorrentDetails(favoriteId, source, detailsData) {
    const sql = `
      INSERT OR REPLACE INTO torrent_details
      (favorite_entry_id, source, details_url, description, files, comments, images, cover_image_url, error_message, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;

    const result = await this.dbManager.run(sql, [
      favoriteId,
      source,
      detailsData.detailsUrl || null,
      detailsData.description || null,
      detailsData.files ? JSON.stringify(detailsData.files) : null,
      detailsData.comments ? JSON.stringify(detailsData.comments) : null,
      detailsData.images ? JSON.stringify(detailsData.images) : null,
      detailsData.coverImageUrl || null,
      detailsData.error || null,
    ]);

    return result.changes > 0;
  }

  async getTorrentDetails(favoriteId, source = null) {
    let sql, params;

    if (source) {
      sql =
        'SELECT * FROM torrent_details WHERE favorite_entry_id = ? AND source = ?';
      params = [favoriteId, source];
    } else {
      sql =
        'SELECT * FROM torrent_details WHERE favorite_entry_id = ? ORDER BY updated_at DESC';
      params = [favoriteId];
    }

    if (source) {
      const row = await this.dbManager.get(sql, params);
      if (row) {
        return {
          id: row.id,
          favoriteEntryId: row.favorite_entry_id,
          source: row.source,
          detailsUrl: row.details_url,
          description: row.description,
          files: row.files ? JSON.parse(row.files) : [],
          comments: row.comments ? JSON.parse(row.comments) : [],
          images: row.images ? JSON.parse(row.images) : [],
          coverImageUrl: row.cover_image_url,
          error: row.error_message,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }
      return null;
    } else {
      const rows = await this.dbManager.all(sql, params);
      return rows.map((row) => ({
        id: row.id,
        favoriteEntryId: row.favorite_entry_id,
        source: row.source,
        detailsUrl: row.details_url,
        description: row.description,
        files: row.files ? JSON.parse(row.files) : [],
        comments: row.comments ? JSON.parse(row.comments) : [],
        images: row.images ? JSON.parse(row.images) : [],
        coverImageUrl: row.cover_image_url,
        error: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    }
  }

  async removeTorrentDetails(favoriteId, source = null) {
    let sql, params;

    if (source) {
      sql =
        'DELETE FROM torrent_details WHERE favorite_entry_id = ? AND source = ?';
      params = [favoriteId, source];
    } else {
      sql = 'DELETE FROM torrent_details WHERE favorite_entry_id = ?';
      params = [favoriteId];
    }

    const result = await this.dbManager.run(sql, params);
    return result.changes > 0;
  }

  // === FAVORITE SCREENSHOTS METHODS (New System) ===

  async addFavoriteScreenshot(favoriteId, screenshotData) {
    const sql = `
      INSERT OR REPLACE INTO favorite_screenshots 
      (favorite_entry_id, timestamp, filename, base64_data, pixhost_url, size_kb, video_url, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await this.dbManager.run(sql, [
      favoriteId,
      screenshotData.timestamp,
      screenshotData.filename || null,
      screenshotData.base64Data || null,
      screenshotData.pixhostUrl || null,
      screenshotData.sizeKB || null,
      screenshotData.videoUrl || null,
      screenshotData.metadata ? JSON.stringify(screenshotData.metadata) : null,
    ]);

    return result.changes > 0;
  }

  async getFavoriteScreenshots(favoriteId) {
    const sql = `
      SELECT * FROM favorite_screenshots 
      WHERE favorite_entry_id = ? 
      ORDER BY timestamp ASC
    `;

    const rows = await this.dbManager.all(sql, [favoriteId]);

    return rows.map((row) => ({
      id: row.id,
      favoriteEntryId: row.favorite_entry_id,
      timestamp: row.timestamp,
      filename: row.filename,
      base64Data: row.base64_data,
      pixhostUrl: row.pixhost_url,
      sizeKB: row.size_kb,
      videoUrl: row.video_url,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
    }));
  }

  async getFavoriteScreenshot(favoriteId, timestamp) {
    const sql = `
      SELECT * FROM favorite_screenshots 
      WHERE favorite_entry_id = ? AND timestamp = ?
    `;

    const row = await this.dbManager.get(sql, [favoriteId, timestamp]);

    if (row) {
      return {
        id: row.id,
        favoriteEntryId: row.favorite_entry_id,
        timestamp: row.timestamp,
        filename: row.filename,
        base64Data: row.base64_data,
        pixhostUrl: row.pixhost_url,
        sizeKB: row.size_kb,
        videoUrl: row.video_url,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        createdAt: row.created_at,
      };
    }

    return null;
  }

  async removeFavoriteScreenshot(favoriteId, timestamp = null) {
    let sql, params;

    if (timestamp !== null) {
      sql =
        'DELETE FROM favorite_screenshots WHERE favorite_entry_id = ? AND timestamp = ?';
      params = [favoriteId, timestamp];
    } else {
      sql = 'DELETE FROM favorite_screenshots WHERE favorite_entry_id = ?';
      params = [favoriteId];
    }

    const result = await this.dbManager.run(sql, params);
    return result.changes > 0;
  }

  async hasFavoriteScreenshots(favoriteId) {
    const sql =
      'SELECT 1 FROM favorite_screenshots WHERE favorite_entry_id = ? LIMIT 1';
    const row = await this.dbManager.get(sql, [favoriteId]);
    return !!row;
  }

  // === MIGRATION HELPERS ===

  async getOrCreateFavoriteEntry(torrent, userId = null) {
    // Try to get existing entry for the user
    let entry = await this.getFavoriteEntry(torrent, userId);

    if (!entry) {
      // Create new entry for the user
      const favoriteId = await this.createFavoriteEntry(torrent, null, userId);
      if (favoriteId) {
        entry = await this.getFavoriteEntryById(favoriteId);
      }
    }

    return entry;
  }

  // === UTILITY METHODS ===

  generateTorrentKey(torrent) {
    if (typeof torrent === 'string') return torrent;

    // For cached links, use a more specific identifier (matching frontend logic)
    if (torrent.isCachedLink && torrent.cachedLinkId) {
      const key = `cached_link_${torrent.cachedLinkId}`;

      return key;
    }

    // Use name, source, and size to create a unique identifier (matching frontend logic)
    const identifier = `${torrent.Name}_${torrent.Source}_${torrent.Size}`;
    let key = identifier.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

    // Limit key length to prevent URL issues (max 200 chars) - matching frontend
    if (key.length > 200) {
      // Keep first 150 chars and add hash of full string for uniqueness
      const hash = this.simpleHash(key);
      key = key.substring(0, 150) + '_' + hash;
    }

    return key;
  }

  /**
   * Simple hash function for creating shorter unique identifiers (matching frontend)
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  extractMagnetHash(magnetLink) {
    const match = magnetLink.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
    if (match) {
      return match[1].toLowerCase();
    }
    // Fallback: use base64 encoded normalized magnet
    return Buffer.from(magnetLink)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 40);
  }

  detectMimeType(buffer) {
    if (!Buffer.isBuffer(buffer)) return 'application/octet-stream';

    // Check for common image formats
    if (buffer.length >= 2) {
      if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
      if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
      if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
      if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
    }

    return 'application/octet-stream';
  }

  // === MAINTENANCE METHODS ===

  async cleanup() {
    // Remove expired entries
    const expiredSql = `
      DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at <= strftime('%s', 'now')
    `;

    await this.dbManager.run(expiredSql);

    // Cleanup old stream URLs
    await this.cleanupOldStreamUrls();

    // Get updated stats
    return this.getStats();
  }

  async printStats() {
    const stats = await this.getStats();
    // Database statistics available via getStats() method
  }

  async getStats() {
    return this.dbManager.getStats();
  }

  async healthCheck() {
    return this.dbManager.healthCheck();
  }

  // === COVER IMAGE UPDATE METHODS ===

  async updateFavoriteEntryCoverImage(favoriteId, coverImageUrl) {
    const sql = 'UPDATE favorite_entries SET cover_image_url = ? WHERE id = ?';
    const result = await this.dbManager.run(sql, [coverImageUrl, favoriteId]);
    return result.changes > 0;
  }

  async updateTorrentDetailsCoverImage(favoriteId, source, coverImageUrl) {
    const sql =
      'UPDATE torrent_details SET cover_image_url = ? WHERE favorite_entry_id = ? AND source = ?';
    const result = await this.dbManager.run(sql, [
      coverImageUrl,
      favoriteId,
      source,
    ]);
    return result.changes > 0;
  }

  async updateCachedLinkCoverImage(cachedLinkId, coverImageUrl) {
    const sql = 'UPDATE cached_links SET cover_image_url = ? WHERE id = ?';
    const result = await this.dbManager.run(sql, [coverImageUrl, cachedLinkId]);
    return result.changes > 0;
  }

  async getCoverImageForTorrent(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);

    // First check if we have the image stored in the images table
    const coverImage = await this.getCoverImageByKey(torrentKey);
    if (coverImage) {
      return coverImage;
    }

    // Check if this is a favorite entry with a cover image URL
    let favoriteEntry = null;

    // First try using the provided favoriteEntryId if available
    if (torrent.favoriteEntryId) {
      // Special debugging for the specific failing favorite entry
      if (torrent.favoriteEntryId === '02d7d8d4-77fd-43e7-b2ef-1a2598917f81') {
      }

      const sql =
        'SELECT id, cover_image_url FROM favorite_entries WHERE id = ?';
      const row = await this.dbManager.get(sql, [torrent.favoriteEntryId]);
      if (row) {
        favoriteEntry = {
          id: row.id,
          coverImageUrl: row.cover_image_url,
        };

        // Special debugging for the specific failing favorite entry
        if (
          torrent.favoriteEntryId === '02d7d8d4-77fd-43e7-b2ef-1a2598917f81'
        ) {
        }
      } else {
        // Special debugging for the specific failing favorite entry
        if (
          torrent.favoriteEntryId === '02d7d8d4-77fd-43e7-b2ef-1a2598917f81'
        ) {
          const checkSql =
            'SELECT id, cover_image_url, torrent_name FROM favorite_entries WHERE id = ?';
          const checkRow = await this.dbManager.get(checkSql, [
            torrent.favoriteEntryId,
          ]);
        }
      }
    } else {
      // Fallback to the existing getFavoriteEntry method

      favoriteEntry = await this.getFavoriteEntry(torrent);
      if (favoriteEntry) {
      } else {
      }
    }

    if (favoriteEntry && favoriteEntry.coverImageUrl) {
      return {
        type: 'url',
        imageUrl: favoriteEntry.coverImageUrl,
        originalUrl: favoriteEntry.coverImageUrl,
      };
    }

    // Check if this is a cached link with a cover image URL
    if (torrent.isCachedLink && torrent.cachedLinkId) {
      const sql = 'SELECT cover_image_url FROM cached_links WHERE id = ?';
      const row = await this.dbManager.get(sql, [torrent.cachedLinkId]);
      if (row && row.cover_image_url) {
        return {
          type: 'url',
          imageUrl: row.cover_image_url,
          originalUrl: row.cover_image_url,
        };
      } else {
      }
    }

    return null;
  }

  async close() {
    return this.dbManager.close();
  }
}

module.exports = UnifiedCache;
