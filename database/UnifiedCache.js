const DatabaseManager = require('./DatabaseManager');

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
    let blobSuccess = false;
    let urlSuccess = false;

    // If we have image data (blob), store it
    if (imageData) {
      const sql = `
        INSERT OR REPLACE INTO images (torrent_key, image_type, image_data, original_url, torrent_name, mime_type)
        VALUES (?, 'cover', ?, ?, ?, ?)
      `;

      const mimeType = this.detectMimeType(imageData);
      const result = await this.dbManager.run(sql, [
        torrentKey,
        imageData,
        imageUrl,
        torrent.Name || 'Unknown',
        mimeType,
      ]);

      blobSuccess = result.changes > 0;
    }

    // Always store the URL reference as fallback
    urlSuccess = await this.set(
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

    // Return true if either storage method succeeded
    return blobSuccess || urlSuccess;
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

    // First try to get from blob storage
    const blobSql = `
      SELECT image_data, mime_type, original_url FROM images 
      WHERE torrent_key = ? AND image_type = 'cover'
    `;

    const row = await this.dbManager.get(blobSql, [torrentKey]);

    if (row) {
      return {
        data: row.image_data,
        mimeType: row.mime_type,
        originalUrl: row.original_url,
        type: 'blob',
      };
    }

    // Fallback to URL cache
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

  async getCoverImageByKey(torrentKey) {
    // First try to get from blob storage
    const blobSql = `
      SELECT image_data, mime_type, original_url FROM images 
      WHERE torrent_key = ? AND image_type = 'cover'
    `;

    const row = await this.dbManager.get(blobSql, [torrentKey]);

    if (row) {
      return {
        data: row.image_data,
        mimeType: row.mime_type,
        originalUrl: row.original_url,
        type: 'blob',
      };
    }

    // Fallback to URL cache
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

    // Check blob storage
    const blobSql =
      'SELECT 1 FROM images WHERE torrent_key = ? AND image_type = ?';
    const blobRow = await this.dbManager.get(blobSql, [torrentKey, 'cover']);

    if (blobRow) {
      return true;
    }

    // Check URL cache
    const urlSql = `
      SELECT 1 FROM cache WHERE key = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
    `;
    const urlRow = await this.dbManager.get(urlSql, [
      `cover_url_${torrentKey}`,
    ]);

    return !!urlRow;
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

  async addFavorite(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);
    const sql = `
      INSERT OR REPLACE INTO favorites (torrent_key, torrent_data)
      VALUES (?, ?)
    `;

    const result = await this.dbManager.run(sql, [
      torrentKey,
      JSON.stringify(torrent),
    ]);
    return result.changes > 0;
  }

  async removeFavorite(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);
    const result = await this.dbManager.run(
      'DELETE FROM favorites WHERE torrent_key = ?',
      [torrentKey]
    );
    return result.changes > 0;
  }

  async getFavorites() {
    const sql =
      'SELECT torrent_data, added_at FROM favorites ORDER BY added_at DESC';
    const rows = await this.dbManager.all(sql);

    try {
      return rows.map((row) => ({
        ...JSON.parse(row.torrent_data),
        addedAt: row.added_at,
      }));
    } catch (parseErr) {
      return [];
    }
  }

  async isFavorite(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);
    const row = await this.dbManager.get(
      'SELECT 1 FROM favorites WHERE torrent_key = ?',
      [torrentKey]
    );
    return !!row;
  }

  // === CACHED LINKS METHODS ===

  async addCachedLink(cachedLink) {
    const sql = `
      INSERT OR REPLACE INTO cached_links 
      (id, url, title, date_added, stream_url, stream_url_cached_at, is_streaming, error, supports_range_requests, filename)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await this.dbManager.run(sql, [
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
    ]);

    return result.changes > 0;
  }

  async removeCachedLink(id) {
    const result = await this.dbManager.run(
      'DELETE FROM cached_links WHERE id = ?',
      [id]
    );
    return result.changes > 0;
  }

  async getCachedLinks(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    
    // Get total count for pagination
    const countSql = 'SELECT COUNT(*) as total FROM cached_links';
    const countResult = await this.dbManager.get(countSql);
    const totalCount = countResult.total;
    const totalPages = Math.ceil(totalCount / limit);
    
    const sql = `
      SELECT id, url, title, date_added, stream_url, stream_url_cached_at, is_streaming, error, supports_range_requests, filename
      FROM cached_links 
      ORDER BY date_added DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await this.dbManager.all(sql, [limit, offset]);

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
      }));
      
      return {
        cachedLinks,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
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
          hasPrevPage: false
        }
      };
    }
  }

  async updateCachedLink(id, updates) {
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

    updateValues.push(id); // Add id for WHERE clause

    const sql = `UPDATE cached_links SET ${updateFields.join(
      ', '
    )} WHERE id = ?`;
    const result = await this.dbManager.run(sql, updateValues);

    return result.changes > 0;
  }

  // === FAVORITE ENTRIES METHODS (New System) ===

  async createFavoriteEntry(torrent) {
    const { v4: uuidv4 } = require('uuid');
    const favoriteId = uuidv4();
    const torrentKey = this.generateTorrentKey(torrent);

    const sql = `
      INSERT OR REPLACE INTO favorite_entries (id, torrent_key, torrent_data, magnet_link, torrent_name)
      VALUES (?, ?, ?, ?, ?)
    `;

    const result = await this.dbManager.run(sql, [
      favoriteId,
      torrentKey,
      JSON.stringify(torrent),
      torrent.MagnetLink || null,
      torrent.Name || 'Unknown',
    ]);

    return result.changes > 0 ? favoriteId : null;
  }

  async getFavoriteEntry(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);
    const sql = 'SELECT * FROM favorite_entries WHERE torrent_key = ?';
    const row = await this.dbManager.get(sql, [torrentKey]);

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
      this.dbManager.get('SELECT COUNT(*) as count FROM favorite_entries')
    ]);
    
    return (oldCount?.count || 0) + (newCount?.count || 0);
  }

  async getMergedFavoritesPaginated(limit, offset) {
    // Use a UNION query to merge both tables and handle deduplication efficiently at database level
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
          WHERE fe.torrent_key = f.torrent_key
        )
      )
      SELECT * FROM merged_favorites
      ORDER BY sort_date DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await this.dbManager.all(sql, [limit, offset]);

    return rows.map((row) => {
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
    }).filter(Boolean);
  }

  async getMergedFavoritesCount() {
    // Get accurate count using same deduplication logic
    const sql = `
      WITH merged_favorites AS (
        -- New favorite entries (these take precedence)
        SELECT torrent_key FROM favorite_entries
        
        UNION
        
        -- Old favorites (only include if torrent_key doesn't exist in favorite_entries)
        SELECT torrent_key FROM favorites f
        WHERE NOT EXISTS (
          SELECT 1 FROM favorite_entries fe 
          WHERE fe.torrent_key = f.torrent_key
        )
      )
      SELECT COUNT(*) as count FROM merged_favorites
    `;

    const result = await this.dbManager.get(sql);
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
      (favorite_entry_id, source, details_url, description, files, comments, images, error_message, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;

    const result = await this.dbManager.run(sql, [
      favoriteId,
      source,
      detailsData.detailsUrl || null,
      detailsData.description || null,
      detailsData.files ? JSON.stringify(detailsData.files) : null,
      detailsData.comments ? JSON.stringify(detailsData.comments) : null,
      detailsData.images ? JSON.stringify(detailsData.images) : null,
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

  async getOrCreateFavoriteEntry(torrent) {
    // Try to get existing entry
    let entry = await this.getFavoriteEntry(torrent);

    if (!entry) {
      // Create new entry
      const favoriteId = await this.createFavoriteEntry(torrent);
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
      console.log(
        '🔑 [UnifiedCache] Generated key for cached link:',
        key,
        'from torrent:',
        torrent.Name
      );
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

  async clearAll() {
    const tables = [
      'cache',
      'images',
      'stream_urls',
      'favorites',
      'cached_links',
      'favorite_entries',
      'torrent_details',
      'favorite_screenshots',
    ];

    for (const table of tables) {
      await this.dbManager.run(`DELETE FROM ${table}`);
    }

    // Vacuum database to reclaim space (only works with local SQLite)
    if (!this.dbManager.isCloudDatabase) {
      await this.dbManager.run('VACUUM');
    }

    await this.printStats();
  }

  async healthCheck() {
    return this.dbManager.healthCheck();
  }

  async close() {
    return this.dbManager.close();
  }
}

module.exports = UnifiedCache;
