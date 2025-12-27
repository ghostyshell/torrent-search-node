const BaseRepository = require('./BaseRepository');

/**
 * Repository for cover image storage operations
 * Handles image URLs, Pixhost integration, and image metadata
 */
class ImageRepository extends BaseRepository {
  constructor(dbManager) {
    super(dbManager);
    this.pixhostService = require('../../services/pixhostService');
  }

  /**
   * Set cover image for a torrent with Pixhost upload
   * @param {object} torrent - Torrent object
   * @param {string} imageUrl - Image URL
   * @param {Buffer|null} imageData - Optional image data
   * @returns {Promise<boolean>} Success status
   */
  async setCoverImage(torrent, imageUrl, imageData = null) {
    const torrentKey = this.generateTorrentKey(torrent);

    try {
      let pixhostUrl = imageUrl;

      // Upload to Pixhost if not already a Pixhost URL
      if (
        imageUrl &&
        !imageUrl.includes('pixhost.to') &&
        !imageUrl.includes('img1.pixhost.to')
      ) {
        try {
          const uploadResult = await this.pixhostService.uploadFromUrl(imageUrl);
          pixhostUrl = uploadResult.directImageUrl;
        } catch (uploadError) {
          // Only log non-network errors to avoid spam from DNS/connectivity issues
          if (!uploadError.message.includes('ENOTFOUND') &&
              !uploadError.message.includes('EAI_AGAIN') &&
              !uploadError.message.includes('ECONNREFUSED') &&
              !uploadError.message.includes('ETIMEDOUT')) {
            console.warn(
              `⚠️ [ImageRepository] Pixhost upload failed, using original URL:`,
              uploadError.message
            );
          }
          // Silently fall back to original URL for network errors
        }
      }

      // Store in images table
      const sql = `
        INSERT OR REPLACE INTO images (torrent_key, image_type, pixhost_url, original_url, torrent_name)
        VALUES (?, 'cover', ?, ?, ?)
      `;

      const result = await this.run(sql, [
        torrentKey,
        pixhostUrl,
        imageUrl,
        torrent.Name || 'Unknown',
      ]);

      return result.changes > 0;
    } catch (error) {
      console.error(
        `❌ [ImageRepository] Error setting cover image for ${torrent.Name}:`,
        error.message
      );
      return false;
    }
  }

  /**
   * Get cover image by torrent object
   * @param {object} torrent - Torrent object
   * @returns {Promise<object|null>} Image data or null
   */
  async getCoverImage(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);
    return this.getCoverImageByKey(torrentKey);
  }

  /**
   * Get cover image by torrent key
   * @param {string} torrentKey - Torrent key
   * @returns {Promise<object|null>} Image data or null
   */
  async getCoverImageByKey(torrentKey) {
    const sql = `
      SELECT pixhost_url, original_url FROM images
      WHERE torrent_key = ? AND image_type = 'cover'
    `;

    const row = await this.get(sql, [torrentKey]);

    if (row && row.pixhost_url) {
      return {
        type: 'url',
        imageUrl: row.pixhost_url,
        originalUrl: row.original_url || row.pixhost_url,
      };
    }

    return null;
  }

  /**
   * Check if cover image exists for torrent
   * @param {object} torrent - Torrent object
   * @returns {Promise<boolean>} True if exists
   */
  async hasCoverImage(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);

    const sql = `
      SELECT 1 FROM images
      WHERE torrent_key = ? AND image_type = ? AND pixhost_url IS NOT NULL
    `;
    const row = await this.get(sql, [torrentKey, 'cover']);

    return !!row;
  }

  /**
   * Update cover image URL for a torrent
   * @param {string} torrentKey - Torrent key
   * @param {string} imageUrl - New image URL
   * @returns {Promise<boolean>} Success status
   */
  async updateCoverImageUrl(torrentKey, imageUrl) {
    const sql = `
      UPDATE images SET pixhost_url = ?, original_url = ?
      WHERE torrent_key = ? AND image_type = 'cover'
    `;
    const result = await this.run(sql, [imageUrl, imageUrl, torrentKey]);
    return result.changes > 0;
  }

  /**
   * Delete cover image for torrent
   * @param {object|string} torrent - Torrent object or key
   * @returns {Promise<boolean>} Success status
   */
  async deleteCoverImage(torrent) {
    const torrentKey =
      typeof torrent === 'string' ? torrent : this.generateTorrentKey(torrent);

    const sql = `
      DELETE FROM images WHERE torrent_key = ? AND image_type = 'cover'
    `;
    const result = await this.run(sql, [torrentKey]);
    return result.changes > 0;
  }

  /**
   * Get all cover images with pagination
   * @param {number} limit - Number of results
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Array of image records
   */
  async getAllCoverImages(limit = 50, offset = 0) {
    const sql = `
      SELECT * FROM images
      WHERE image_type = 'cover'
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    return this.all(sql, [limit, offset]);
  }

  /**
   * Get statistics about stored images
   * @returns {Promise<object>} Image statistics
   */
  async getStats() {
    const countResult = await this.get(
      'SELECT COUNT(*) as count FROM images WHERE image_type = ?',
      ['cover']
    );

    return {
      totalImages: countResult?.count || 0,
    };
  }
}

module.exports = ImageRepository;
