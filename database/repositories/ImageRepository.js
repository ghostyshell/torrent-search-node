const BaseRepository = require('./BaseRepository');

class ImageRepository extends BaseRepository {
  constructor(dbManager) {
    super(dbManager);
    this.pixhostService = require('../../services/pixhostService');
    this.multiHostService = require('../../services/multiHostImageService');
  }

  /**
   * Set cover image for a torrent, uploading to Pixhost (primary) and all
   * fallback hosts in parallel.
   */
  async setCoverImage(torrent, imageUrl, imageData = null) {
    const torrentKey = this.generateTorrentKey(torrent);

    try {
      let pixhostUrl = imageUrl;
      let imageBuffer = null;
      let fallbackUrls = [];

      // Fetch buffer once for re-use across all host uploads
      if (imageUrl && !imageUrl.includes('pixhost.to')) {
        try {
          const fetch = require('node-fetch');
          const response = await fetch(imageUrl, {
            timeout: 30000,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Accept: 'image/*,*/*;q=0.8',
            },
          });
          if (response.ok) {
            imageBuffer = await response.buffer();
          }
        } catch {
          // silently fall through
        }
      }

      // Upload to Pixhost (primary)
      if (imageBuffer) {
        try {
          const uploadResult = await this.pixhostService.uploadBuffer(imageBuffer);
          pixhostUrl = uploadResult.directImageUrl;
        } catch (uploadError) {
          const msg = uploadError.message || '';
          if (
            !msg.includes('ENOTFOUND') &&
            !msg.includes('EAI_AGAIN') &&
            !msg.includes('ECONNREFUSED') &&
            !msg.includes('ETIMEDOUT')
          ) {
            console.warn(`⚠️ [ImageRepository] Pixhost upload failed:`, msg);
          }
        }
      } else if (
        imageUrl &&
        !imageUrl.includes('pixhost.to') &&
        !imageUrl.includes('img1.pixhost.to')
      ) {
        // Buffer fetch failed — try URL-based upload as fallback
        try {
          const uploadResult = await this.pixhostService.uploadFromUrl(imageUrl);
          pixhostUrl = uploadResult.directImageUrl;
        } catch {
          // silently keep original URL
        }
      }

      // Upload to fallback hosts in parallel (non-blocking; never fails the whole save)
      if (imageBuffer) {
        try {
          const results = await this.multiHostService.uploadToAllHosts(imageBuffer);
          // Extract just the URLs from { host, url } objects
          fallbackUrls = results.map((r) => r.url).filter(Boolean);
        } catch {
          // silently omit fallbacks
        }
      }

      const sql = `
        INSERT OR REPLACE INTO images (torrent_key, image_type, pixhost_url, original_url, torrent_name, fallback_urls)
        VALUES (?, 'cover', ?, ?, ?, ?)
      `;

      const result = await this.run(sql, [
        torrentKey,
        pixhostUrl,
        imageUrl,
        torrent.Name || 'Unknown',
        fallbackUrls.length > 0 ? JSON.stringify(fallbackUrls) : null,
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
      SELECT pixhost_url, original_url, fallback_urls FROM images
      WHERE torrent_key = ? AND image_type = 'cover'
    `;

    const row = await this.get(sql, [torrentKey]);

    if (row && row.pixhost_url) {
      let fallbackUrls = [];
      if (row.fallback_urls) {
        try {
          fallbackUrls = JSON.parse(row.fallback_urls);
        } catch {
          fallbackUrls = [];
        }
      }
      return {
        type: 'url',
        imageUrl: row.pixhost_url,
        originalUrl: row.original_url || row.pixhost_url,
        fallbackUrls,
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
      UPDATE images SET pixhost_url = ?, original_url = ?
      WHERE torrent_key = ? AND image_type = 'cover'
    `;
    const result = await this.run(sql, [imageUrl, imageUrl, torrentKey]);
    return result.changes > 0;
  }

  /**
   * Update fallback_urls for an existing image row.
   * Called by the bulk migration job.
   */
  async updateFallbackUrls(torrentKey, fallbackUrls) {
    const sql = `
      UPDATE images SET fallback_urls = ?
      WHERE torrent_key = ? AND image_type = 'cover'
    `;
    const result = await this.run(sql, [
      fallbackUrls.length > 0 ? JSON.stringify(fallbackUrls) : null,
      torrentKey,
    ]);
    return result.changes > 0;
  }

  /**
   * Return rows that have a pixhost_url but no fallback_urls yet,
   * for use by the bulk migration job.
   */
  async getImagesNeedingMigration(limit = 50, offset = 0) {
    const sql = `
      SELECT torrent_key, pixhost_url, original_url FROM images
      WHERE image_type = 'cover'
        AND pixhost_url IS NOT NULL
        AND (fallback_urls IS NULL OR fallback_urls = '')
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `;
    return this.all(sql, [limit, offset]);
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

    const withFallbacksResult = await this.get(
      `SELECT COUNT(*) as count FROM images WHERE image_type = 'cover' AND fallback_urls IS NOT NULL AND fallback_urls != ''`,
      []
    );

    return {
      totalImages: countResult?.count || 0,
      withFallbackUrls: withFallbacksResult?.count || 0,
    };
  }

  /**
   * Get image record by pixhost URL (for looking up backup host fallbacks)
   */
  async getByPixhostUrl(pixhostUrl) {
    const sql = `
      SELECT pixhost_url, original_url, fallback_urls FROM images
      WHERE image_type = 'cover' AND pixhost_url = ?
    `;
    const row = await this.get(sql, [pixhostUrl]);

    if (row && row.pixhost_url) {
      let fallbackUrls = [];
      if (row.fallback_urls) {
        try {
          fallbackUrls = JSON.parse(row.fallback_urls);
        } catch {
          fallbackUrls = [];
        }
      }
      return {
        type: 'url',
        imageUrl: row.pixhost_url,
        originalUrl: row.original_url || row.pixhost_url,
        fallbackUrls,
      };
    }

    return null;
  }
}

module.exports = ImageRepository;
