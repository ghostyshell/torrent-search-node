const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * SQLite-based unified cache manager for torrent data
 *
 * Stores:
 * - Cover images (as blob data)
 * - Stream URLs
 * - Video screenshots
 * - Manual images
 * - Favorites
 * - Search results (temporary cache)
 */
class SQLiteCache {
  constructor(dbPath = './cache/torrent_cache.db') {
    // Ensure cache directory exists
    const cacheDir = path.dirname(dbPath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    this.dbPath = dbPath;
    this.db = null;
    this.initializeDatabase();

    console.log('📁 SQLite cache initialized at:', dbPath);
  }

  initializeDatabase() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
          return;
        }

        this.initializeTables()
          .then(() => {
            console.log('✅ SQLite database initialized');
            this.printStats();
            resolve();
          })
          .catch(reject);
      });
    });
  }

  initializeTables() {
    return new Promise((resolve, reject) => {
      const tables = [
        // Cache table for general key-value storage
        `CREATE TABLE IF NOT EXISTS cache (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'json',
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          expires_at INTEGER,
          metadata TEXT
        )`,

        // Image cache table for binary data
        `CREATE TABLE IF NOT EXISTS images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          torrent_key TEXT NOT NULL,
          image_type TEXT NOT NULL, -- 'cover', 'screenshot', 'manual'
          image_data BLOB NOT NULL,
          mime_type TEXT,
          original_url TEXT,
          torrent_name TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          metadata TEXT,
          UNIQUE(torrent_key, image_type)
        )`,

        // Stream URLs table
        `CREATE TABLE IF NOT EXISTS stream_urls (
          magnet_hash TEXT PRIMARY KEY,
          stream_url TEXT NOT NULL,
          filename TEXT,
          filesize INTEGER,
          supports_range_requests BOOLEAN DEFAULT 0,
          torrent_name TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          last_accessed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )`,

        // Favorites table
        `CREATE TABLE IF NOT EXISTS favorites (
          torrent_key TEXT PRIMARY KEY,
          torrent_data TEXT NOT NULL, -- JSON serialized torrent object
          added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )`,
      ];

      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_cache_type ON cache(type)',
        'CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at)',
        'CREATE INDEX IF NOT EXISTS idx_images_torrent ON images(torrent_key)',
        'CREATE INDEX IF NOT EXISTS idx_images_type ON images(image_type)',
        'CREATE INDEX IF NOT EXISTS idx_stream_accessed ON stream_urls(last_accessed_at)',
      ];

      // Execute all table creation queries
      this.db.serialize(() => {
        tables.forEach((sql) => {
          this.db.run(sql, (err) => {
            if (err) {
              console.error('Error creating table:', err);
              reject(err);
              return;
            }
          });
        });

        indexes.forEach((sql) => {
          this.db.run(sql, (err) => {
            if (err) {
              console.error('Error creating index:', err);
            }
          });
        });

        resolve();
      });
    });
  }

  // Helper method to generate torrent key
  generateTorrentKey(torrent) {
    if (typeof torrent === 'string') return torrent;
    const identifier = `${torrent.Name}_${torrent.Source}_${torrent.Size}`;
    return identifier.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  }

  // Helper method to extract magnet hash
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

  // === GENERAL CACHE METHODS ===

  set(key, value, ttlSeconds = null, type = 'json', metadata = null) {
    return new Promise((resolve, reject) => {
      const expiresAt = ttlSeconds
        ? Math.floor(Date.now() / 1000) + ttlSeconds
        : null;
      const valueStr = type === 'json' ? JSON.stringify(value) : value;
      const metadataStr = metadata ? JSON.stringify(metadata) : null;

      const sql = `
        INSERT OR REPLACE INTO cache (key, value, type, expires_at, metadata, updated_at)
        VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
      `;

      this.db.run(
        sql,
        [key, valueStr, type, expiresAt, metadataStr],
        function (err) {
          if (err) {
            console.error('Error setting cache:', err);
            reject(err);
            return;
          }

          console.log(
            `💾 Cached: ${key} (type: ${type}, ttl: ${
              ttlSeconds || 'permanent'
            }s)`
          );
          resolve(true);
        }
      );
    });
  }

  get(key, defaultValue = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT value, type, expires_at FROM cache 
        WHERE key = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
      `;

      this.db.get(sql, [key], (err, row) => {
        if (err) {
          console.error('Error getting cache:', err);
          reject(err);
          return;
        }

        if (!row) {
          console.log(`🔍 Cache miss: ${key}`);
          resolve(defaultValue);
          return;
        }

        console.log(`✅ Cache hit: ${key}`);
        try {
          const value = row.type === 'json' ? JSON.parse(row.value) : row.value;
          resolve(value);
        } catch (parseErr) {
          console.error('Error parsing cached value:', parseErr);
          resolve(defaultValue);
        }
      });
    });
  }

  delete(key) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM cache WHERE key = ?', [key], function (err) {
        if (err) {
          console.error('Error deleting cache:', err);
          reject(err);
          return;
        }

        console.log(`🗑️ Deleted cache: ${key} (affected: ${this.changes})`);
        resolve(this.changes > 0);
      });
    });
  }

  // === COVER IMAGE METHODS ===

  async setCoverImage(torrent, imageUrl, imageData = null) {
    const torrentKey = this.generateTorrentKey(torrent);

    // If we have image data (blob), store it
    if (imageData) {
      return new Promise((resolve, reject) => {
        const sql = `
          INSERT OR REPLACE INTO images (torrent_key, image_type, image_data, original_url, torrent_name, mime_type)
          VALUES (?, 'cover', ?, ?, ?, ?)
        `;

        const mimeType = this.detectMimeType(imageData);

        this.db.run(
          sql,
          [
            torrentKey,
            imageData,
            imageUrl,
            torrent.Name || 'Unknown',
            mimeType,
          ],
          function (err) {
            if (err) {
              console.error('Error storing cover image:', err);
              reject(err);
              return;
            }

            console.log(`💾 Stored cover image for: ${torrent.Name}`);
            resolve(true);
          }
        );
      });
    }

    // Always store the URL reference
    return this.set(
      `cover_url_${torrentKey}`,
      {
        imageUrl,
        torrentName: torrent.Name,
        originalUrl: imageUrl,
      },
      null,
      'json',
      { type: 'cover_image' }
    );
  }

  getCoverImage(torrent) {
    return new Promise((resolve, reject) => {
      const torrentKey = this.generateTorrentKey(torrent);

      // First try to get from blob storage
      const blobSql = `
        SELECT image_data, mime_type, original_url FROM images 
        WHERE torrent_key = ? AND image_type = 'cover'
      `;

      this.db.get(blobSql, [torrentKey], async (err, row) => {
        if (err) {
          console.error('Error getting cover image blob:', err);
          reject(err);
          return;
        }

        if (row) {
          console.log(
            `✅ Found cached cover image (blob) for: ${torrent.Name}`
          );
          resolve({
            data: row.image_data,
            mimeType: row.mime_type,
            originalUrl: row.original_url,
            type: 'blob',
          });
          return;
        }

        // Fallback to URL cache
        try {
          const urlData = await this.get(`cover_url_${torrentKey}`);
          if (urlData) {
            console.log(`✅ Found cached cover URL for: ${torrent.Name}`);
            resolve({ ...urlData, type: 'url' });
          } else {
            resolve(null);
          }
        } catch (urlErr) {
          console.error('Error getting cover URL:', urlErr);
          resolve(null);
        }
      });
    });
  }

  hasCoverImage(torrent) {
    return new Promise((resolve, reject) => {
      const torrentKey = this.generateTorrentKey(torrent);

      // Check blob storage
      const blobSql =
        'SELECT 1 FROM images WHERE torrent_key = ? AND image_type = ?';

      this.db.get(blobSql, [torrentKey, 'cover'], async (err, blobRow) => {
        if (err) {
          reject(err);
          return;
        }

        if (blobRow) {
          resolve(true);
          return;
        }

        // Check URL cache
        const urlSql = `
          SELECT 1 FROM cache WHERE key = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
        `;

        this.db.get(urlSql, [`cover_url_${torrentKey}`], (urlErr, urlRow) => {
          if (urlErr) {
            reject(urlErr);
            return;
          }

          resolve(!!urlRow);
        });
      });
    });
  }

  // === STREAM URL METHODS ===

  setStreamUrl(magnetLink, streamData) {
    return new Promise((resolve, reject) => {
      const magnetHash = this.extractMagnetHash(magnetLink);

      const sql = `
        INSERT OR REPLACE INTO stream_urls 
        (magnet_hash, stream_url, filename, filesize, supports_range_requests, torrent_name, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
      `;

      this.db.run(
        sql,
        [
          magnetHash,
          streamData.streamUrl,
          streamData.filename || null,
          streamData.filesize || null,
          streamData.supportsRangeRequests ? 1 : 0,
          streamData.torrentName || null,
        ],
        function (err) {
          if (err) {
            console.error('Error caching stream URL:', err);
            reject(err);
            return;
          }

          console.log(
            `💾 Cached stream URL for: ${streamData.filename || magnetHash}`
          );
          // Note: cleanupOldStreamUrls would need to be called separately
          resolve(true);
        }
      );
    });
  }

  getStreamUrl(magnetLink) {
    return new Promise((resolve, reject) => {
      const magnetHash = this.extractMagnetHash(magnetLink);

      const sql = 'SELECT * FROM stream_urls WHERE magnet_hash = ?';

      this.db.get(sql, [magnetHash], (err, row) => {
        if (err) {
          console.error('Error getting stream URL:', err);
          reject(err);
          return;
        }

        if (row) {
          // Update last accessed time
          const updateSql = `
            UPDATE stream_urls SET last_accessed_at = strftime('%s', 'now') WHERE magnet_hash = ?
          `;
          this.db.run(updateSql, [magnetHash], (updateErr) => {
            if (updateErr) {
              console.warn('Could not update last accessed time:', updateErr);
            }
          });

          console.log(
            `✅ Found cached stream URL for: ${row.filename || magnetHash}`
          );
          resolve({
            streamUrl: row.stream_url,
            filename: row.filename,
            filesize: row.filesize,
            supportsRangeRequests: !!row.supports_range_requests,
            cachedAt: row.created_at,
            lastAccessed: row.last_accessed_at,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  getStreamUrlByHash(magnetHash) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM stream_urls WHERE magnet_hash = ?';

      this.db.get(sql, [magnetHash], (err, row) => {
        if (err) {
          console.error('Error getting stream URL by hash:', err);
          reject(err);
          return;
        }

        if (row) {
          // Update last_accessed_at
          this.db.run(
            'UPDATE stream_urls SET last_accessed_at = strftime("%s", "now") WHERE magnet_hash = ?',
            [magnetHash],
            (updateErr) => {
              if (updateErr) {
                console.error('Error updating last_accessed_at:', updateErr);
              }
            }
          );

          console.log(
            `✅ Found cached stream URL by hash for: ${
              row.filename || magnetHash
            }`
          );
          resolve({
            streamUrl: row.stream_url,
            filename: row.filename,
            filesize: row.filesize,
            supportsRangeRequests: !!row.supports_range_requests,
            cachedAt: row.created_at,
            lastAccessed: row.last_accessed_at,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  hasStreamUrl(magnetLink) {
    return new Promise((resolve, reject) => {
      const magnetHash = this.extractMagnetHash(magnetLink);
      const sql = 'SELECT 1 FROM stream_urls WHERE magnet_hash = ?';

      this.db.get(sql, [magnetHash], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(!!row);
      });
    });
  }

  cleanupOldStreamUrls(maxEntries = 100) {
    return new Promise((resolve, reject) => {
      // First count current entries
      this.db.get(
        'SELECT COUNT(*) as count FROM stream_urls',
        [],
        (countErr, countRow) => {
          if (countErr) {
            reject(countErr);
            return;
          }

          const count = countRow.count;
          if (count <= maxEntries) {
            resolve(0);
            return;
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

          this.db.run(deleteSql, [toDelete], function (deleteErr) {
            if (deleteErr) {
              reject(deleteErr);
              return;
            }

            console.log(`🧹 Cleaned up ${this.changes} old stream URLs`);
            resolve(this.changes);
          });
        }
      );
    });
  }

  // === FAVORITES METHODS ===

  addFavorite(torrent) {
    return new Promise((resolve, reject) => {
      const torrentKey = this.generateTorrentKey(torrent);

      const sql = `
        INSERT OR REPLACE INTO favorites (torrent_key, torrent_data)
        VALUES (?, ?)
      `;

      this.db.run(sql, [torrentKey, JSON.stringify(torrent)], function (err) {
        if (err) {
          console.error('Error adding favorite:', err);
          reject(err);
          return;
        }

        console.log(`⭐ Added favorite: ${torrent.Name}`);
        resolve(true);
      });
    });
  }

  removeFavorite(torrent) {
    return new Promise((resolve, reject) => {
      const torrentKey = this.generateTorrentKey(torrent);

      this.db.run(
        'DELETE FROM favorites WHERE torrent_key = ?',
        [torrentKey],
        function (err) {
          if (err) {
            console.error('Error removing favorite:', err);
            reject(err);
            return;
          }

          if (this.changes > 0) {
            console.log(`💔 Removed favorite: ${torrent.Name}`);
            resolve(true);
          } else {
            resolve(false);
          }
        }
      );
    });
  }

  getFavorites() {
    return new Promise((resolve, reject) => {
      const sql =
        'SELECT torrent_data, added_at FROM favorites ORDER BY added_at DESC';

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          console.error('Error getting favorites:', err);
          reject(err);
          return;
        }

        try {
          const favorites = rows.map((row) => ({
            ...JSON.parse(row.torrent_data),
            addedAt: row.added_at,
          }));
          resolve(favorites);
        } catch (parseErr) {
          console.error('Error parsing favorites:', parseErr);
          resolve([]);
        }
      });
    });
  }

  isFavorite(torrent) {
    return new Promise((resolve, reject) => {
      const torrentKey = this.generateTorrentKey(torrent);

      this.db.get(
        'SELECT 1 FROM favorites WHERE torrent_key = ?',
        [torrentKey],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(!!row);
        }
      );
    });
  }

  // === UTILITY METHODS ===

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

  // === MAINTENANCE METHODS ===

  cleanup() {
    return new Promise((resolve, reject) => {
      console.log('🧹 Running cache cleanup...');

      // Remove expired entries
      const expiredSql = `
        DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at <= strftime('%s', 'now')
      `;

      this.db.run(expiredSql, [], (err) => {
        if (err) {
          console.error('Error removing expired entries:', err);
          reject(err);
          return;
        }

        console.log(`✅ Removed ${this.changes} expired entries`);

        // Cleanup old stream URLs
        this.cleanupOldStreamUrls()
          .then(() => {
            // Vacuum database to reclaim space
            this.db.run('VACUUM', [], (vacuumErr) => {
              if (vacuumErr) {
                console.warn('Could not vacuum database:', vacuumErr);
              }

              console.log('✅ Cleanup completed');
              this.printStats();
              resolve();
            });
          })
          .catch(reject);
      });
    });
  }

  printStats() {
    const queries = [
      { name: 'General Cache', sql: 'SELECT COUNT(*) as count FROM cache' },
      { name: 'Images', sql: 'SELECT COUNT(*) as count FROM images' },
      { name: 'Stream URLs', sql: 'SELECT COUNT(*) as count FROM stream_urls' },
      { name: 'Favorites', sql: 'SELECT COUNT(*) as count FROM favorites' },
    ];

    console.log('📊 Cache Statistics:');

    queries.forEach(({ name, sql }) => {
      this.db.get(sql, [], (err, row) => {
        if (err) {
          console.log(`   ${name}: Error - ${err.message}`);
        } else {
          console.log(`   ${name}: ${row.count} entries`);
        }
      });
    });
  }

  getStats() {
    return new Promise((resolve, reject) => {
      const stats = {};
      const queries = [
        { key: 'cache', sql: 'SELECT COUNT(*) as count FROM cache' },
        { key: 'images', sql: 'SELECT COUNT(*) as count FROM images' },
        { key: 'streamUrls', sql: 'SELECT COUNT(*) as count FROM stream_urls' },
        { key: 'favorites', sql: 'SELECT COUNT(*) as count FROM favorites' },
      ];

      let completed = 0;
      const total = queries.length;

      queries.forEach(({ key, sql }) => {
        this.db.get(sql, [], (err, row) => {
          if (err) {
            stats[key] = 0;
            console.error(`Error getting ${key} stats:`, err);
          } else {
            stats[key] = row.count;
          }

          completed++;
          if (completed === total) {
            stats.dbSize = this.getDatabaseSize();
            resolve(stats);
          }
        });
      });
    });
  }

  getDatabaseSize() {
    try {
      const stats = fs.statSync(this.dbPath);
      const sizeInBytes = stats.size;

      if (sizeInBytes < 1024) return `${sizeInBytes} B`;
      if (sizeInBytes < 1024 * 1024)
        return `${(sizeInBytes / 1024).toFixed(1)} KB`;
      return `${(sizeInBytes / 1024 / 1024).toFixed(1)} MB`;
    } catch (error) {
      return '0 MB';
    }
  }

  clearAll() {
    return new Promise((resolve, reject) => {
      console.log('🗑️ Clearing all caches...');

      const tables = ['cache', 'images', 'stream_urls', 'favorites'];
      let completed = 0;
      const total = tables.length;

      tables.forEach((table) => {
        this.db.run(`DELETE FROM ${table}`, [], (err) => {
          if (err) {
            console.error(`Error clearing ${table}:`, err);
          }

          completed++;
          if (completed === total) {
            this.db.run('VACUUM', [], (vacuumErr) => {
              if (vacuumErr) {
                console.warn('Could not vacuum after clear:', vacuumErr);
              }

              console.log('✅ All caches cleared');
              this.printStats();
              resolve();
            });
          }
        });
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('🔒 SQLite cache database closed');
        }
      });
    }
  }
}

module.exports = SQLiteCache;
