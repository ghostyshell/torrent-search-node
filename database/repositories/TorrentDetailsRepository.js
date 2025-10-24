const BaseRepository = require('./BaseRepository');

/**
 * Repository for torrent details and screenshots
 * Manages detailed torrent information and associated screenshots
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
   * Add screenshot for a favorite
   * @param {string} favoriteId - Favorite entry ID
   * @param {object} screenshotData - Screenshot data
   * @returns {Promise<boolean>} Success status
   */
  async addScreenshot(favoriteId, screenshotData) {
    const sql = `
      INSERT OR REPLACE INTO favorite_screenshots
      (favorite_entry_id, timestamp, filename, base64_data, pixhost_url, size_kb, video_url, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await this.run(sql, [
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

  /**
   * Get screenshots for a favorite
   * @param {string} favoriteId - Favorite entry ID
   * @returns {Promise<Array>} Array of screenshots
   */
  async getScreenshots(favoriteId) {
    const sql = `
      SELECT * FROM favorite_screenshots
      WHERE favorite_entry_id = ?
      ORDER BY timestamp ASC
    `;

    const rows = await this.all(sql, [favoriteId]);
    return rows.map((row) => this._mapScreenshot(row));
  }

  /**
   * Get single screenshot
   * @param {string} favoriteId - Favorite entry ID
   * @param {number} timestamp - Screenshot timestamp
   * @returns {Promise<object|null>} Screenshot or null
   */
  async getScreenshot(favoriteId, timestamp) {
    const sql = `
      SELECT * FROM favorite_screenshots
      WHERE favorite_entry_id = ? AND timestamp = ?
    `;

    const row = await this.get(sql, [favoriteId, timestamp]);

    if (row) {
      return this._mapScreenshot(row);
    }

    return null;
  }

  /**
   * Remove screenshot(s) for a favorite
   * @param {string} favoriteId - Favorite entry ID
   * @param {number|null} timestamp - Optional specific timestamp
   * @returns {Promise<boolean>} Success status
   */
  async removeScreenshot(favoriteId, timestamp = null) {
    let sql, params;

    if (timestamp !== null) {
      sql =
        'DELETE FROM favorite_screenshots WHERE favorite_entry_id = ? AND timestamp = ?';
      params = [favoriteId, timestamp];
    } else {
      sql = 'DELETE FROM favorite_screenshots WHERE favorite_entry_id = ?';
      params = [favoriteId];
    }

    const result = await this.run(sql, params);
    return result.changes > 0;
  }

  /**
   * Check if screenshots exist for a favorite
   * @param {string} favoriteId - Favorite entry ID
   * @returns {Promise<boolean>} True if screenshots exist
   */
  async hasScreenshots(favoriteId) {
    const sql =
      'SELECT 1 FROM favorite_screenshots WHERE favorite_entry_id = ? LIMIT 1';
    const row = await this.get(sql, [favoriteId]);
    return !!row;
  }

  /**
   * Get statistics about torrent details and screenshots
   * @returns {Promise<object>} Statistics
   */
  async getStats() {
    const [detailsCount, screenshotsCount] = await Promise.all([
      this.get('SELECT COUNT(*) as count FROM torrent_details'),
      this.get('SELECT COUNT(*) as count FROM favorite_screenshots'),
    ]);

    return {
      totalTorrentDetails: detailsCount?.count || 0,
      totalScreenshots: screenshotsCount?.count || 0,
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

  /**
   * Map database row to screenshot object
   * @private
   */
  _mapScreenshot(row) {
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
}

module.exports = TorrentDetailsRepository;
