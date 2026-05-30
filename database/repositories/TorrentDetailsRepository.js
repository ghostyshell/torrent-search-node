const BaseRepository = require('./BaseRepository');

/**
 * Repository for torrent details
 * Manages detailed torrent information
 */
class TorrentDetailsRepository extends BaseRepository {
  /**
   * Set torrent details
   * @param {string} favoriteId - Favorite entry ID
   * @param {string} source - Source of the details
   * @param {object} detailsData - Details data
   * @returns {Promise<boolean>} Success status
   */
  async setTorrentDetails(favoriteId, source, detailsData) {
    const sql = `
      INSERT OR REPLACE INTO torrent_details
      (favorite_entry_id, source, details_url, description, files, comments, images, cover_image_url, error_message, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;

    const result = await this.run(sql, [
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

  /**
   * Get torrent details
   * @param {string} favoriteId - Favorite entry ID
   * @param {string|null} source - Optional source filter
   * @returns {Promise<object|Array|null>} Torrent details
   */
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
      const row = await this.get(sql, params);
      if (row) {
        return this._mapTorrentDetails(row);
      }
      return null;
    } else {
      const rows = await this.all(sql, params);
      return rows.map((row) => this._mapTorrentDetails(row));
    }
  }

  /**
   * Update torrent details cover image
   * @param {string} favoriteId - Favorite entry ID
   * @param {string} source - Source
   * @param {string} coverImageUrl - Cover image URL
   * @returns {Promise<boolean>} Success status
   */
  async updateCoverImage(favoriteId, source, coverImageUrl) {
    const sql =
      'UPDATE torrent_details SET cover_image_url = ? WHERE favorite_entry_id = ? AND source = ?';
    const result = await this.run(sql, [coverImageUrl, favoriteId, source]);
    return result.changes > 0;
  }

  /**
   * Remove torrent details
   * @param {string} favoriteId - Favorite entry ID
   * @param {string|null} source - Optional source filter
   * @returns {Promise<boolean>} Success status
   */
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

    const result = await this.run(sql, params);
    return result.changes > 0;
  }

  /**
   * Get statistics about torrent details
   * @returns {Promise<object>} Statistics
   */
  async getStats() {
    const detailsCount = await this.get(
      'SELECT COUNT(*) as count FROM torrent_details'
    );

    return {
      totalTorrentDetails: detailsCount?.count || 0,
    };
  }

  /**
   * Map database row to torrent details object
   * @private
   */
  _mapTorrentDetails(row) {
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
}

module.exports = TorrentDetailsRepository;
