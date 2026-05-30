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

  /**
   * Batch-load cover images for many torrent keys in a single query.
   * Avoids the N+1 pattern when enriching a page of favorites.
   * @param {string[]} torrentKeys
   * @returns {Promise<Map<string, object>>} Map of torrentKey -> cover image object
   */
  async getCoverImagesByKeys(torrentKeys) {
    const result = new Map();
    if (!Array.isArray(torrentKeys) || torrentKeys.length === 0) {
      return result;
    }

    // De-duplicate keys before building the IN clause.
    const uniqueKeys = [...new Set(torrentKeys)];

    // Chunk the IN clause to stay under SQLite's bound-variable limit and keep
    // individual queries efficient.
    const chunkSize = 500;
    for (let start = 0; start < uniqueKeys.length; start += chunkSize) {
      const chunk = uniqueKeys.slice(start, start + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');

      const sql = `
        SELECT torrent_key, pixhost_url, storage_key FROM images
        WHERE image_type = 'cover' AND torrent_key IN (${placeholders})
      `;

      const rows = await this.all(sql, chunk);

      for (const row of rows) {
        if (!row.pixhost_url) continue;
        result.set(row.torrent_key, {
          type: 'url',
          imageUrl: row.pixhost_url,
          originalUrl: row.pixhost_url,
          fallbackUrls: [],
          storageKey: row.storage_key,
        });
      }
    }

    return result;
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
