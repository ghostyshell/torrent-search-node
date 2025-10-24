const BaseRepository = require('./BaseRepository');

/**
 * Repository for stream URL caching
 * Manages cached streaming URLs for magnet links with automatic cleanup
 */
class StreamUrlRepository extends BaseRepository {
  /**
   * Set stream URL for a magnet link
   * @param {string} magnetLink - Magnet link
   * @param {object} streamData - Stream data object
   * @returns {Promise<boolean>} Success status
   */
  async setStreamUrl(magnetLink, streamData) {
    const magnetHash = this.extractMagnetHash(magnetLink);

    const sql = `
      INSERT OR REPLACE INTO stream_urls
      (magnet_hash, stream_url, filename, filesize, supports_range_requests, torrent_name, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;

    const result = await this.run(sql, [
      magnetHash,
      streamData.streamUrl,
      streamData.filename || null,
      streamData.filesize || null,
      streamData.supportsRangeRequests ? 1 : 0,
      streamData.torrentName || null,
    ]);

    return result.changes > 0;
  }

  /**
   * Get stream URL by magnet link
   * @param {string} magnetLink - Magnet link
   * @returns {Promise<object|null>} Stream data or null
   */
  async getStreamUrl(magnetLink) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    return this.getStreamUrlByHash(magnetHash);
  }

  /**
   * Get stream URL by magnet hash
   * @param {string} magnetHash - Magnet hash
   * @returns {Promise<object|null>} Stream data or null
   */
  async getStreamUrlByHash(magnetHash) {
    const sql = 'SELECT * FROM stream_urls WHERE magnet_hash = ?';
    const row = await this.get(sql, [magnetHash]);

    if (row) {
      // Update last accessed time
      const updateSql = `
        UPDATE stream_urls SET last_accessed_at = strftime('%s', 'now') WHERE magnet_hash = ?
      `;
      await this.run(updateSql, [magnetHash]);

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

  /**
   * Check if stream URL exists for magnet link
   * @param {string} magnetLink - Magnet link
   * @returns {Promise<boolean>} True if exists
   */
  async hasStreamUrl(magnetLink) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    const sql = 'SELECT 1 FROM stream_urls WHERE magnet_hash = ?';
    const row = await this.get(sql, [magnetHash]);
    return !!row;
  }

  /**
   * Delete stream URL by magnet link
   * @param {string} magnetLink - Magnet link
   * @returns {Promise<boolean>} Success status
   */
  async deleteStreamUrl(magnetLink) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    const result = await this.run('DELETE FROM stream_urls WHERE magnet_hash = ?', [
      magnetHash,
    ]);
    return result.changes > 0;
  }

  /**
   * Clean up old stream URLs keeping only the most recent entries
   * @param {number} maxEntries - Maximum number of entries to keep
   * @returns {Promise<number>} Number of deleted entries
   */
  async cleanupOldStreamUrls(maxEntries = 100) {
    // First count current entries
    const countRow = await this.get(
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

    const result = await this.run(deleteSql, [toDelete]);
    return result.changes;
  }

  /**
   * Get all stream URLs with pagination
   * @param {number} limit - Number of results
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Array of stream URL records
   */
  async getAllStreamUrls(limit = 50, offset = 0) {
    const sql = `
      SELECT * FROM stream_urls
      ORDER BY last_accessed_at DESC
      LIMIT ? OFFSET ?
    `;
    return this.all(sql, [limit, offset]);
  }

  /**
   * Get statistics about stored stream URLs
   * @returns {Promise<object>} Stream URL statistics
   */
  async getStats() {
    const countResult = await this.get(
      'SELECT COUNT(*) as count FROM stream_urls'
    );

    return {
      totalStreamUrls: countResult?.count || 0,
    };
  }
}

module.exports = StreamUrlRepository;
