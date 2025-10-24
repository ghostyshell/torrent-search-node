const BaseRepository = require('./BaseRepository');

/**
 * Repository for cached links storage
 * Manages user-saved links with streaming information
 */
class CachedLinkRepository extends BaseRepository {
  /**
   * Add a cached link
   * @param {object} cachedLink - Cached link object
   * @param {string|null} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
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

    const result = await this.run(sql, values);
    return result.changes > 0;
  }

  /**
   * Get cached link by ID
   * @param {string} id - Cached link ID
   * @param {string|null} userId - User ID
   * @returns {Promise<object|null>} Cached link or null
   */
  async getCachedLinkById(id, userId = null) {
    let sql, params;
    if (userId) {
      sql = 'SELECT * FROM cached_links WHERE id = ? AND user_id = ?';
      params = [id, userId];
    } else {
      sql = 'SELECT * FROM cached_links WHERE id = ?';
      params = [id];
    }

    const row = await this.get(sql, params);
    if (row) {
      return this._mapCachedLink(row);
    }
    return null;
  }

  /**
   * Get cached links with pagination
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @param {string|null} userId - User ID
   * @returns {Promise<object>} Cached links with pagination info
   */
  async getCachedLinks(page = 1, limit = 20, userId = null) {
    const offset = (page - 1) * limit;

    // Get total count for pagination
    let countSql, countParams;
    if (userId) {
      countSql = 'SELECT COUNT(*) as total FROM cached_links WHERE user_id = ?';
      countParams = [userId];
    } else {
      countSql = 'SELECT COUNT(*) as total FROM cached_links WHERE user_id IS NULL';
      countParams = [];
    }

    const countResult = await this.get(countSql, countParams);
    const totalCount = countResult.total;
    const totalPages = Math.ceil(totalCount / limit);

    let sql, params;
    if (userId) {
      sql = `
        SELECT id, url, title, date_added, stream_url, stream_url_cached_at, is_streaming, error, supports_range_requests, filename, cover_image_url, user_id
        FROM cached_links
        WHERE user_id = ?
        ORDER BY date_added DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, limit, offset];
    } else {
      sql = `
        SELECT id, url, title, date_added, stream_url, stream_url_cached_at, is_streaming, error, supports_range_requests, filename, cover_image_url, user_id
        FROM cached_links
        WHERE user_id IS NULL
        ORDER BY date_added DESC
        LIMIT ? OFFSET ?
      `;
      params = [limit, offset];
    }

    const rows = await this.all(sql, params);

    try {
      const cachedLinks = rows.map((row) => this._mapCachedLink(row));

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

  /**
   * Update cached link
   * @param {string} id - Cached link ID
   * @param {object} updates - Fields to update
   * @param {string|null} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async updateCachedLink(id, updates, userId = null) {
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
    if (updates.coverImageUrl !== undefined) {
      updateFields.push('cover_image_url = ?');
      updateValues.push(updates.coverImageUrl);
    }

    if (updateFields.length === 0) {
      return false;
    }

    let sql;
    if (userId) {
      updateValues.push(id, userId);
      sql = `UPDATE cached_links SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`;
    } else {
      updateValues.push(id);
      sql = `UPDATE cached_links SET ${updateFields.join(', ')} WHERE id = ? AND user_id IS NULL`;
    }

    const result = await this.run(sql, updateValues);
    return result.changes > 0;
  }

  /**
   * Update cached link cover image
   * @param {string} cachedLinkId - Cached link ID
   * @param {string} coverImageUrl - Cover image URL
   * @returns {Promise<boolean>} Success status
   */
  async updateCoverImage(cachedLinkId, coverImageUrl) {
    const sql = 'UPDATE cached_links SET cover_image_url = ? WHERE id = ?';
    const result = await this.run(sql, [coverImageUrl, cachedLinkId]);
    return result.changes > 0;
  }

  /**
   * Remove cached link
   * @param {string} id - Cached link ID
   * @param {string|null} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async removeCachedLink(id, userId = null) {
    let sql, params;
    if (userId) {
      sql = 'DELETE FROM cached_links WHERE id = ? AND user_id = ?';
      params = [id, userId];
    } else {
      sql = 'DELETE FROM cached_links WHERE id = ? AND user_id IS NULL';
      params = [id];
    }

    const result = await this.run(sql, params);
    return result.changes > 0;
  }

  /**
   * Get statistics about cached links
   * @returns {Promise<object>} Cached links statistics
   */
  async getStats() {
    const countResult = await this.get(
      'SELECT COUNT(*) as count FROM cached_links'
    );

    return {
      totalCachedLinks: countResult?.count || 0,
    };
  }

  /**
   * Map database row to cached link object
   * @private
   */
  _mapCachedLink(row) {
    return {
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
      coverImageUrl: row.cover_image_url,
      userId: row.user_id,
    };
  }
}

module.exports = CachedLinkRepository;
