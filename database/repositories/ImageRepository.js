const BaseRepository = require('./BaseRepository');

class ImageRepository extends BaseRepository {
  constructor(dbManager) {
    super(dbManager);
    this.objectStorageService = require('../../services/objectStorageService');
  }

  /**
   * Set cover image for a torrent, uploading to S3 object storage.
   */
  async setCoverImage(torrent, imageUrl, imageData = null) {
    const torrentKey = this.generateTorrentKey(torrent);

    try {
      // Upload to S3 object storage
      const { key, error } = await this.objectStorageService.uploadCoverFromUrl({
        torrentKey,
        imageUrl,
        isFavorite: !!torrent.favoriteEntryId,
      });

      if (!key) {
        console.warn(`⚠️ [ImageRepository] S3 upload failed:`, error);
        return false;
      }

      // Get presigned URL for immediate use
      const presignedUrl = await this.objectStorageService.getPresignedUrl(key);

      const sql = `
        INSERT OR REPLACE INTO images (torrent_key, image_type, pixhost_url, original_url, torrent_name, storage_key)
        VALUES (?, 'cover', ?, ?, ?, ?)
      `;

      const result = await this.run(sql, [
        torrentKey,
        presignedUrl,
        imageUrl,
        torrent.Name || 'Unknown',
        key,
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

  async getCoverImage(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);
    return this.getCoverImageByKey(torrentKey);
  }

  async getCoverImageByKey(torrentKey) {
    const sql = `
      SELECT pixhost_url, storage_key FROM images
      WHERE torrent_key = ? AND image_type = 'cover'
    `;

    const row = await this.get(sql, [torrentKey]);

    if (!row) return null;

    // Return S3 presigned URL (stored in pixhost_url column)
    if (row.pixhost_url) {
      return {
        type: 'url',
        imageUrl: row.pixhost_url,
        originalUrl: row.pixhost_url,
        fallbackUrls: [],
        storageKey: row.storage_key,
      };
    }

    return null;
  }

  async hasCoverImage(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);

    const sql = `
      SELECT 1 FROM images
      WHERE torrent_key = ? AND image_type = ? AND pixhost_url IS NOT NULL
    `;
    const row = await this.get(sql, [torrentKey, 'cover']);

    return !!row;
  }

  async updateCoverImageUrl(torrentKey, imageUrl) {
    const sql = `
      UPDATE images SET pixhost_url = ?
      WHERE torrent_key = ? AND image_type = 'cover'
    `;
    const result = await this.run(sql, [imageUrl, torrentKey]);
    return result.changes > 0;
  }

  /**
   * Cover rows backed by object storage, for the presigned-URL refresh job.
   */
  async getObjectStorageCovers(limit = 200, offset = 0) {
    const sql = `
      SELECT torrent_key, storage_key FROM images
      WHERE image_type = 'cover' AND storage_key IS NOT NULL
      ORDER BY torrent_key ASC
      LIMIT ? OFFSET ?
    `;
    return this.all(sql, [limit, offset]);
  }

  async updateCoverPresignedUrl(torrentKey, presignedUrl) {
    const sql = `
      UPDATE images SET pixhost_url = ?
      WHERE torrent_key = ? AND image_type = 'cover'
    `;
    const result = await this.run(sql, [presignedUrl, torrentKey]);
    return result.changes > 0;
  }

  /** Delete a cover row by its object storage key (used by the cleanup job). */
  async deleteCoverByStorageKey(storageKey) {
    const sql = `DELETE FROM images WHERE image_type = 'cover' AND storage_key = ?`;
    const result = await this.run(sql, [storageKey]);
    return result.changes > 0;
  }

  async deleteCoverImage(torrent) {
    const torrentKey =
      typeof torrent === 'string' ? torrent : this.generateTorrentKey(torrent);

    const sql = `
      DELETE FROM images WHERE torrent_key = ? AND image_type = 'cover'
    `;
    const result = await this.run(sql, [torrentKey]);
    return result.changes > 0;
  }

  async getAllCoverImages(limit = 50, offset = 0) {
    const sql = `
      SELECT * FROM images
      WHERE image_type = 'cover'
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    return this.all(sql, [limit, offset]);
  }

  async getStats() {
    const countResult = await this.get(
      'SELECT COUNT(*) as count FROM images WHERE image_type = ?',
      ['cover']
    );

    const withStorageResult = await this.get(
      `SELECT COUNT(*) as count FROM images WHERE image_type = 'cover' AND storage_key IS NOT NULL`,
      []
    );

    return {
      totalImages: countResult?.count || 0,
      withObjectStorage: withStorageResult?.count || 0,
    };
  }
}

module.exports = ImageRepository;
