/**
 * Base repository class providing common database operations
 * All specific repositories extend this base class
 */
class BaseRepository {
  constructor(dbManager) {
    if (!dbManager) {
      throw new Error('DatabaseManager instance is required');
    }
    this.db = dbManager;
  }

  /**
   * Execute a SQL query
   */
  async execute(sql, params = []) {
    return this.db.execute(sql, params);
  }

  /**
   * Get a single row
   */
  async get(sql, params = []) {
    return this.db.get(sql, params);
  }

  /**
   * Get all rows
   */
  async all(sql, params = []) {
    return this.db.all(sql, params);
  }

  /**
   * Run a query (INSERT, UPDATE, DELETE)
   */
  async run(sql, params = []) {
    return this.db.run(sql, params);
  }

  /**
   * Begin a transaction
   */
  async beginTransaction() {
    return this.db.beginTransaction();
  }

  /**
   * Commit a transaction
   */
  async commitTransaction() {
    return this.db.commitTransaction();
  }

  /**
   * Rollback a transaction
   */
  async rollbackTransaction() {
    return this.db.rollbackTransaction();
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction(queries) {
    return this.db.transaction(queries);
  }

  /**
   * Generate a torrent key from torrent object
   */
  generateTorrentKey(torrent) {
    if (typeof torrent === 'string') return torrent;

    // For cached links, use a more specific identifier
    if (torrent.isCachedLink && torrent.cachedLinkId) {
      return `cached_link_${torrent.cachedLinkId}`;
    }

    // Use name, source, and size to create a unique identifier
    const identifier = `${torrent.Name}_${torrent.Source}_${torrent.Size}`;
    let key = identifier.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

    // Limit key length to prevent URL issues (max 200 chars)
    if (key.length > 200) {
      const hash = this.simpleHash(key);
      key = key.substring(0, 150) + '_' + hash;
    }

    return key;
  }

  /**
   * Simple hash function for creating shorter unique identifiers
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Extract magnet hash from magnet link
   */
  extractMagnetHash(magnetLink) {
    const match = magnetLink.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
    if (match) {
      return match[1].toLowerCase();
    }
    // Fallback: use base64 encoded normalized magnet
    return Buffer.from(magnetLink)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 40);
  }

  /**
   * Detect MIME type from buffer
   */
  detectMimeType(buffer) {
    if (!Buffer.isBuffer(buffer)) return 'application/octet-stream';

    // Check for common image formats
    if (buffer.length >= 2) {
      if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
      if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
      if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
      if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
    }

    return 'application/octet-stream';
  }
}

module.exports = BaseRepository;
