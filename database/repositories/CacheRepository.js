const BaseRepository = require('./BaseRepository');

/**
 * Repository for general key-value cache operations
 * Handles temporary data storage with optional TTL
 */
class CacheRepository extends BaseRepository {
  /**
   * Set a cache value with optional TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number|null} ttlSeconds - Time to live in seconds
   * @param {string} type - Value type ('json' or 'text')
   * @param {object|null} metadata - Optional metadata
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, ttlSeconds = null, type = 'json', metadata = null) {
    const expiresAt = ttlSeconds
      ? Math.floor(Date.now() / 1000) + ttlSeconds
      : null;
    const valueStr = type === 'json' ? JSON.stringify(value) : value;
    const metadataStr = metadata ? JSON.stringify(metadata) : null;

    const sql = `
      INSERT OR REPLACE INTO cache (key, value, type, expires_at, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;

    const result = await this.run(sql, [
      key,
      valueStr,
      type,
      expiresAt,
      metadataStr,
    ]);
    return result.changes > 0;
  }

  /**
   * Get a cache value by key
   * @param {string} key - Cache key
   * @param {any} defaultValue - Default value if not found
   * @returns {Promise<any>} Cached value or default
   */
  async get(key, defaultValue = null) {
    const sql = `
      SELECT value, type, expires_at FROM cache
      WHERE key = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
    `;

    const row = await this.db.get(sql, [key]);

    if (!row) {
      return defaultValue;
    }

    try {
      const value = row.type === 'json' ? JSON.parse(row.value) : row.value;
      return value;
    } catch (parseErr) {
      return defaultValue;
    }
  }

  /**
   * Delete a cache entry
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async delete(key) {
    const result = await this.run('DELETE FROM cache WHERE key = ?', [key]);
    return result.changes > 0;
  }

  /**
   * Clean up expired cache entries
   * @returns {Promise<number>} Number of deleted entries
   */
  async cleanupExpired() {
    const sql = `
      DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at <= strftime('%s', 'now')
    `;
    const result = await this.run(sql);
    return result.changes;
  }

  /**
   * Get cache statistics
   * @returns {Promise<object>} Cache stats
   */
  async getStats() {
    const countResult = await this.get('SELECT COUNT(*) as count FROM cache');
    const expiredResult = await this.get(
      `SELECT COUNT(*) as count FROM cache WHERE expires_at IS NOT NULL AND expires_at <= strftime('%s', 'now')`
    );

    return {
      totalEntries: countResult?.count || 0,
      expiredEntries: expiredResult?.count || 0,
    };
  }

  /**
   * Clear all cache entries
   * @returns {Promise<number>} Number of deleted entries
   */
  async clear() {
    const result = await this.run('DELETE FROM cache');
    return result.changes;
  }
}

module.exports = CacheRepository;
