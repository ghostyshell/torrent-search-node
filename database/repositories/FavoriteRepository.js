const BaseRepository = require('./BaseRepository');
const { v4: uuidv4 } = require('uuid');

/**
 * Repository for favorites management
 * Handles favorite entries, cover images, and user-specific favorites
 */
class FavoriteRepository extends BaseRepository {
  /**
   * Create a new favorite entry
   * @param {object} torrent - Torrent object
   * @param {string|null} coverImageUrl - Optional cover image URL
   * @param {string|null} userId - User ID
   * @returns {Promise<string|null>} Favorite ID or null
   */
  async createFavoriteEntry(torrent, coverImageUrl = null, userId = null) {
    const favoriteId = uuidv4();
    const torrentKey = this.generateTorrentKey(torrent);

    const sql = `
      INSERT OR REPLACE INTO favorite_entries (id, torrent_key, torrent_data, magnet_link, torrent_name, cover_image_url, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await this.run(sql, [
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

  /**
   * Get favorite entry by torrent
   * @param {object} torrent - Torrent object
   * @param {string|null} userId - User ID
   * @returns {Promise<object|null>} Favorite entry or null
   */
  async getFavoriteEntry(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const sql = userId
      ? 'SELECT * FROM favorite_entries WHERE torrent_key = ? AND user_id = ?'
      : 'SELECT * FROM favorite_entries WHERE torrent_key = ? AND user_id IS NULL';
    const params = userId ? [torrentKey, userId] : [torrentKey];
    const row = await this.get(sql, params);

    if (row) {
      return this._mapFavoriteEntry(row);
    }

    return null;
  }

  /**
   * Get favorite entry by ID
   * @param {string} favoriteId - Favorite ID
   * @returns {Promise<object|null>} Favorite entry or null
   */
  async getFavoriteEntryById(favoriteId) {
    const sql = 'SELECT * FROM favorite_entries WHERE id = ?';
    const row = await this.get(sql, [favoriteId]);

    if (row) {
      return this._mapFavoriteEntry(row);
    }

    return null;
  }

  /**
   * Get favorite entry by torrent key
   * @param {string} torrentKey - Torrent key
   * @returns {Promise<object|null>} Favorite entry or null
   */
  async getFavoriteEntryByKey(torrentKey) {
    const sql = 'SELECT * FROM favorite_entries WHERE torrent_key = ?';
    const row = await this.get(sql, [torrentKey]);

    if (row) {
      return this._mapFavoriteEntry(row);
    }

    return null;
  }

  /**
   * Get all favorite entries with pagination
   * @param {number} limit - Number of results
   * @param {number} offset - Offset for pagination
   * @param {string|null} userId - Optional user ID filter
   * @returns {Promise<Array>} Array of favorite entries
   */
  async getFavoriteEntries(limit, offset, userId = null) {
    let sql, params;

    if (userId) {
      sql = `
        SELECT * FROM favorite_entries
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, limit, offset];
    } else {
      sql = `
        SELECT * FROM favorite_entries
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [limit, offset];
    }

    const rows = await this.all(sql, params);
    return rows.map((row) => this._mapFavoriteEntry(row));
  }

  /**
   * Get merged favorites from both old and new systems
   * @param {number} limit - Number of results
   * @param {number} offset - Offset for pagination
   * @param {string|null} userId - User ID
   * @returns {Promise<Array>} Array of favorite entries
   */
  async getMergedFavorites(limit, offset, userId = null) {
    const userFilter = userId ? 'WHERE user_id = ?' : 'WHERE user_id IS NULL';
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
    const rows = await this.all(sql, params);

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

  /**
   * Get merged favorites count
   * @param {string|null} userId - User ID
   * @returns {Promise<number>} Total count
   */
  async getMergedFavoritesCount(userId = null) {
    const userFilterFe = userId ? 'WHERE user_id = ?' : 'WHERE user_id IS NULL';
    const userFilterF = userId ? 'AND f.user_id = ?' : 'AND f.user_id IS NULL';

    const sql = `
      WITH merged_favorites AS (
        -- New favorite entries
        SELECT torrent_key FROM favorite_entries
        ${userFilterFe}

        UNION

        -- Old favorites
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
    const result = await this.get(sql, params);
    return result?.count || 0;
  }

  /**
   * Check if torrent is a favorite
   * @param {object} torrent - Torrent object
   * @param {string|null} userId - User ID
   * @returns {Promise<boolean>} True if favorite
   */
  async isFavorite(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);

    const feQuery = userId
      ? 'SELECT 1 FROM favorite_entries WHERE torrent_key = ? AND user_id = ?'
      : 'SELECT 1 FROM favorite_entries WHERE torrent_key = ? AND user_id IS NULL';
    const fQuery = userId
      ? 'SELECT 1 FROM favorites WHERE torrent_key = ? AND user_id = ?'
      : 'SELECT 1 FROM favorites WHERE torrent_key = ? AND user_id IS NULL';

    const params = userId ? [torrentKey, userId] : [torrentKey];

    const [feRow, fRow] = await Promise.all([
      this.get(feQuery, params),
      this.get(fQuery, params),
    ]);

    return !!(feRow || fRow);
  }

  /**
   * Remove favorite entry
   * @param {string} favoriteId - Favorite ID
   * @returns {Promise<boolean>} Success status
   */
  async removeFavoriteEntry(favoriteId) {
    const sql = 'DELETE FROM favorite_entries WHERE id = ?';
    const result = await this.run(sql, [favoriteId]);
    return result.changes > 0;
  }

  /**
   * Update favorite entry cover image
   * @param {string} favoriteId - Favorite ID
   * @param {string} coverImageUrl - Cover image URL
   * @returns {Promise<boolean>} Success status
   */
  async updateCoverImage(favoriteId, coverImageUrl) {
    const sql = 'UPDATE favorite_entries SET cover_image_url = ? WHERE id = ?';
    const result = await this.run(sql, [coverImageUrl, favoriteId]);
    return result.changes > 0;
  }

  /**
   * Get or create favorite entry
   * @param {object} torrent - Torrent object
   * @param {string|null} userId - User ID
   * @returns {Promise<object|null>} Favorite entry
   */
  async getOrCreateFavoriteEntry(torrent, userId = null) {
    let entry = await this.getFavoriteEntry(torrent, userId);

    if (!entry) {
      const favoriteId = await this.createFavoriteEntry(torrent, null, userId);
      if (favoriteId) {
        entry = await this.getFavoriteEntryById(favoriteId);
      }
    }

    return entry;
  }

  /**
   * Get statistics about favorites
   * @returns {Promise<object>} Favorites statistics
   */
  async getStats() {
    const [oldCount, newCount] = await Promise.all([
      this.get('SELECT COUNT(*) as count FROM favorites'),
      this.get('SELECT COUNT(*) as count FROM favorite_entries'),
    ]);

    return {
      oldFavorites: oldCount?.count || 0,
      newFavoriteEntries: newCount?.count || 0,
      total: (oldCount?.count || 0) + (newCount?.count || 0),
    };
  }

  /**
   * Get all favorite entries with magnet links for stream URL refresh
   * Groups by user_id for batch processing
   * @returns {Promise<Array>} Array of {userId, favorites: [{id, magnetLink, torrentName}]}
   */
  async getAllFavoritesForStreamRefresh() {
    // Query both favorite_entries and old favorites table
    // Extract magnet link from column or from torrent_data JSON (stored as "Magnet")
    const sql = `
      SELECT
        id,
        COALESCE(magnet_link, json_extract(torrent_data, '$.Magnet')) as magnet_link,
        COALESCE(torrent_name, json_extract(torrent_data, '$.Name')) as torrent_name,
        user_id
      FROM favorite_entries
      WHERE COALESCE(magnet_link, json_extract(torrent_data, '$.Magnet')) IS NOT NULL

      UNION ALL

      SELECT
        torrent_key as id,
        json_extract(torrent_data, '$.Magnet') as magnet_link,
        json_extract(torrent_data, '$.Name') as torrent_name,
        user_id
      FROM favorites
      WHERE json_extract(torrent_data, '$.Magnet') IS NOT NULL

      ORDER BY user_id
    `;

    const rows = await this.all(sql);

    // Group by user_id
    const userFavorites = {};
    for (const row of rows) {
      if (!row.magnet_link) continue;

      const userId = row.user_id || 'anonymous';
      if (!userFavorites[userId]) {
        userFavorites[userId] = [];
      }
      userFavorites[userId].push({
        id: row.id,
        magnetLink: row.magnet_link,
        torrentName: row.torrent_name || 'Unknown',
      });
    }

    return Object.entries(userFavorites).map(([userId, favorites]) => ({
      userId: userId === 'anonymous' ? null : userId,
      favorites,
    }));
  }

  /**
   * Get count of favorites with magnet links
   * @returns {Promise<number>} Count
   */
  async getFavoritesWithMagnetLinksCount() {
    const result = await this.get(
      'SELECT COUNT(*) as count FROM favorite_entries WHERE magnet_link IS NOT NULL AND magnet_link != \'\''
    );
    return result?.count || 0;
  }

  /**
   * Map database row to favorite entry object
   * @private
   */
  _mapFavoriteEntry(row) {
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

  // Legacy favorites methods for backward compatibility

  /**
   * Add favorite (legacy method)
   * @param {object} torrent - Torrent object
   * @param {string|null} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async addFavorite(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const sql = `
      INSERT OR REPLACE INTO favorites (torrent_key, torrent_data, user_id)
      VALUES (?, ?, ?)
    `;

    const result = await this.run(sql, [
      torrentKey,
      JSON.stringify(torrent),
      userId,
    ]);
    return result.changes > 0;
  }

  /**
   * Remove favorite (legacy method)
   * @param {object} torrent - Torrent object
   * @param {string|null} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async removeFavorite(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const sql = userId
      ? 'DELETE FROM favorites WHERE torrent_key = ? AND user_id = ?'
      : 'DELETE FROM favorites WHERE torrent_key = ? AND user_id IS NULL';
    const params = userId ? [torrentKey, userId] : [torrentKey];

    const result = await this.run(sql, params);
    return result.changes > 0;
  }

  /**
   * Get favorites (legacy method)
   * @param {string|null} userId - User ID
   * @returns {Promise<Array>} Array of favorites
   */
  async getFavorites(userId = null) {
    const sql = userId
      ? 'SELECT torrent_data, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC'
      : 'SELECT torrent_data, added_at FROM favorites WHERE user_id IS NULL ORDER BY added_at DESC';
    const params = userId ? [userId] : [];
    const rows = await this.all(sql, params);

    try {
      return rows.map((row) => ({
        ...JSON.parse(row.torrent_data),
        addedAt: row.added_at,
      }));
    } catch (parseErr) {
      return [];
    }
  }
}

module.exports = FavoriteRepository;
