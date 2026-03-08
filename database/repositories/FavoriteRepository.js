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
      torrent.Magnet || torrent.MagnetLink || null,
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
   * Get favorites from favorite_entries table, de-duplicated by magnet link.
   * When multiple entries share the same magnet link, only the most recently
   * added entry is returned.  Entries without a magnet link are never
   * collapsed against each other.
   * @param {number} limit - Number of results
   * @param {number} offset - Offset for pagination
   * @param {string|null} userId - User ID
   * @returns {Promise<Array>} Array of favorite entries
   */
  async getMergedFavorites(limit, offset, userId = null) {
    const userFilter = userId ? 'WHERE user_id = ?' : 'WHERE user_id IS NULL';

    const sql = `
      SELECT torrent_key, torrent_data, sort_date, favorite_entry_id
      FROM (
        SELECT
          torrent_key,
          torrent_data,
          created_at AS sort_date,
          id AS favorite_entry_id,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(magnet_link, id)
            ORDER BY created_at DESC
          ) AS rn
        FROM favorite_entries
        ${userFilter}
      )
      WHERE rn = 1
      ORDER BY sort_date DESC
      LIMIT ? OFFSET ?
    `;

    const params = userId ? [userId, limit, offset] : [limit, offset];
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
   * Get de-duplicated favorites count (mirrors getMergedFavorites logic)
   * @param {string|null} userId - User ID
   * @returns {Promise<number>} Total count
   */
  async getMergedFavoritesCount(userId = null) {
    const userFilter = userId ? 'WHERE user_id = ?' : 'WHERE user_id IS NULL';

    const sql = `
      SELECT COUNT(DISTINCT COALESCE(magnet_link, id)) AS count
      FROM favorite_entries
      ${userFilter}
    `;
    const params = userId ? [userId] : [];
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

    const sql = userId
      ? 'SELECT 1 FROM favorite_entries WHERE torrent_key = ? AND user_id = ?'
      : 'SELECT 1 FROM favorite_entries WHERE torrent_key = ? AND user_id IS NULL';
    const params = userId ? [torrentKey, userId] : [torrentKey];

    const row = await this.get(sql, params);
    return !!row;
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
   * Update favorite entry magnet link
   * @param {string} favoriteId - Favorite ID
   * @param {string} magnetLink - Magnet link
   * @returns {Promise<boolean>} Success status
   */
  async updateMagnetLink(favoriteId, magnetLink) {
    const sql = 'UPDATE favorite_entries SET magnet_link = ?, updated_at = strftime(\'%s\', \'now\') WHERE id = ?';
    const result = await this.run(sql, [magnetLink, favoriteId]);
    return result.changes > 0;
  }

  /**
   * Update favorite entry magnet link and torrent data
   * This updates both the magnet_link column and the Magnet field in torrent_data JSON
   * @param {string} favoriteId - Favorite ID
   * @param {string} magnetLink - Magnet link
   * @returns {Promise<boolean>} Success status
   */
  async updateMagnetLinkAndData(favoriteId, magnetLink) {
    // First get the current favorite entry
    const entry = await this.getFavoriteEntryById(favoriteId);
    if (!entry) {
      return false;
    }

    // Update the torrent data to include the magnet link
    const updatedTorrentData = {
      ...entry.torrentData,
      Magnet: magnetLink,
    };

    const sql = `
      UPDATE favorite_entries
      SET magnet_link = ?,
          torrent_data = ?,
          updated_at = strftime('%s', 'now')
      WHERE id = ?
    `;
    const result = await this.run(sql, [magnetLink, JSON.stringify(updatedTorrentData), favoriteId]);
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
    const result = await this.get('SELECT COUNT(*) as count FROM favorite_entries');
    const count = result?.count || 0;

    return {
      favoriteEntries: count,
      total: count,
    };
  }

  /**
   * Get all favorite entries with magnet links for stream URL refresh.
   * De-duplicated by magnet link per user so the same torrent isn't
   * refreshed multiple times.  Groups results by user_id for batch processing.
   * @returns {Promise<Array>} Array of {userId, favorites: [{id, magnetLink, torrentName}]}
   */
  async getAllFavoritesForStreamRefresh() {
    const sql = `
      SELECT id, magnet_link, torrent_name, user_id
      FROM (
        SELECT
          id,
          COALESCE(magnet_link, json_extract(torrent_data, '$.Magnet')) AS magnet_link,
          COALESCE(torrent_name, json_extract(torrent_data, '$.Name')) AS torrent_name,
          user_id,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, COALESCE(magnet_link, json_extract(torrent_data, '$.Magnet'))
            ORDER BY created_at DESC
          ) AS rn
        FROM favorite_entries
        WHERE COALESCE(magnet_link, json_extract(torrent_data, '$.Magnet')) IS NOT NULL
      )
      WHERE rn = 1
      ORDER BY user_id
    `;

    const rows = await this.all(sql);

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

  // Favorites write methods

  /**
   * Add favorite
   * Writes to favorite_entries (the primary table used by all reads)
   * @param {object} torrent - Torrent object
   * @param {string|null} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async addFavorite(torrent, userId = null) {
    const entry = await this.getOrCreateFavoriteEntry(torrent, userId);
    return !!entry;
  }

  /**
   * Remove favorite
   * Removes from favorite_entries (the primary table used by all reads)
   * @param {object} torrent - Torrent object
   * @param {string|null} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async removeFavorite(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const sql = userId
      ? 'DELETE FROM favorite_entries WHERE torrent_key = ? AND user_id = ?'
      : 'DELETE FROM favorite_entries WHERE torrent_key = ? AND user_id IS NULL';
    const params = userId ? [torrentKey, userId] : [torrentKey];

    const result = await this.run(sql, params);
    return result.changes > 0;
  }

}

module.exports = FavoriteRepository;
