/**
 * Database abstraction layer for Turso cloud database
 * Provides connection pooling, retry logic, and optimized cloud database operations
 */
class DatabaseManager {
  constructor(config = {}) {
    // Load environment variables
    require('dotenv').config();

    this.config = {
      // Environment detection
      environment: process.env.NODE_ENV || 'development',

      // Turso cloud configuration
      tursoUrl: process.env.TURSO_DATABASE_URL,
      tursoAuthToken: process.env.TURSO_AUTH_TOKEN,

      // Connection and retry settings
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      connectionTimeout: config.connectionTimeout || 10000,

      ...config,
    };

    this.isCloudDatabase = true; // Always use cloud database now
    this.retryCount = 0;
  }

  /**
   * Initialize database connection
   */
  async initializeConnection() {
    try {
      await this.testTursoConnection();
      await this.initializeSchema();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Test Turso connection
   */
  async testTursoConnection() {
    const maxRetries = this.config.maxRetries;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Simple test query to verify connection
        await this.executeTursoQuery('SELECT 1 as test');
        return;
      } catch (error) {
        lastError = error;
        // Connection attempt failed

        if (attempt < maxRetries) {
          await this.delay(this.config.retryDelay * attempt);
        }
      }
    }

    throw new Error(
      `Failed to connect to Turso after ${maxRetries} attempts: ${lastError.message}`
    );
  }

  /**
   * Execute query on Turso database
   */
  async executeTursoQuery(sql, params = []) {
    const axios = require('axios');

    try {
      const payload = {
        stmt: {
          sql: sql,
          args: params.map((param) => {
            if (param === null) return { type: 'null' };
            if (typeof param === 'string')
              return { type: 'text', value: param };
            if (typeof param === 'number')
              return { type: 'integer', value: param.toString() };
            if (typeof param === 'boolean')
              return { type: 'integer', value: param ? '1' : '0' };
            if (Buffer.isBuffer(param))
              return { type: 'blob', base64: param.toString('base64') };
            return { type: 'text', value: String(param) };
          }),
        },
      };

      const response = await axios.post(
        `${this.config.tursoUrl}/v1/execute`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.config.tursoAuthToken}`,
            'Content-Type': 'application/json',
          },
          timeout: this.config.connectionTimeout,
        }
      );

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Turso API error: ${error.response.status} - ${JSON.stringify(
            error.response.data
          )}`
        );
      }
      throw new Error(`Turso query failed: ${error.message}`);
    }
  }

  /**
   * Initialize database schema
   */
  async initializeSchema() {
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
        image_type TEXT NOT NULL,
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
        torrent_data TEXT NOT NULL,
        added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )`,

      // Cached links table
      `CREATE TABLE IF NOT EXISTS cached_links (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        date_added TEXT NOT NULL,
        stream_url TEXT,
        stream_url_cached_at TEXT,
        is_streaming BOOLEAN DEFAULT 0,
        error TEXT,
        supports_range_requests BOOLEAN DEFAULT 0,
        filename TEXT
      )`,

      // Favorite entries table - each favorite gets a unique entry
      `CREATE TABLE IF NOT EXISTS favorite_entries (
        id TEXT PRIMARY KEY,
        torrent_key TEXT NOT NULL UNIQUE,
        torrent_data TEXT NOT NULL,
        magnet_link TEXT,
        torrent_name TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        metadata TEXT
      )`,

      // Torrent details table - store all torrent details linked to favorite entries
      `CREATE TABLE IF NOT EXISTS torrent_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        favorite_entry_id TEXT NOT NULL,
        source TEXT NOT NULL,
        details_url TEXT,
        description TEXT,
        files TEXT,
        comments TEXT,
        images TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (favorite_entry_id) REFERENCES favorite_entries(id) ON DELETE CASCADE,
        UNIQUE(favorite_entry_id, source)
      )`,

      // Favorite screenshots table - store screenshots linked to favorite entries
      `CREATE TABLE IF NOT EXISTS favorite_screenshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        favorite_entry_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        filename TEXT,
        base64_data TEXT,
        pixhost_url TEXT,
        size_kb INTEGER,
        video_url TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        metadata TEXT,
        FOREIGN KEY (favorite_entry_id) REFERENCES favorite_entries(id) ON DELETE CASCADE,
        UNIQUE(favorite_entry_id, timestamp)
      )`,
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_cache_type ON cache(type)',
      'CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_images_torrent ON images(torrent_key)',
      'CREATE INDEX IF NOT EXISTS idx_images_type ON images(image_type)',
      'CREATE INDEX IF NOT EXISTS idx_stream_accessed ON stream_urls(last_accessed_at)',
      'CREATE INDEX IF NOT EXISTS idx_cached_links_date ON cached_links(date_added)',
      'CREATE INDEX IF NOT EXISTS idx_favorite_entries_torrent_key ON favorite_entries(torrent_key)',
      'CREATE INDEX IF NOT EXISTS idx_favorite_entries_created ON favorite_entries(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_torrent_details_entry_id ON torrent_details(favorite_entry_id)',
      'CREATE INDEX IF NOT EXISTS idx_torrent_details_source ON torrent_details(source)',
      'CREATE INDEX IF NOT EXISTS idx_favorite_screenshots_entry_id ON favorite_screenshots(favorite_entry_id)',
      'CREATE INDEX IF NOT EXISTS idx_favorite_screenshots_timestamp ON favorite_screenshots(timestamp)',
    ];

    // Execute schema creation
    for (const sql of tables) {
      await this.execute(sql);
    }

    for (const sql of indexes) {
      await this.execute(sql);
    }

    // Migration: Add missing columns to cached_links table
    await this.migrateCachedLinksTable();

    // Migration: Add cover image columns to other tables
    await this.migrateCoverImageColumns();
  }

  /**
   * Migration method to add missing columns to cached_links table
   */
  async migrateCachedLinksTable() {
    const missingColumns = [
      { name: 'stream_url_cached_at', type: 'TEXT' },
      { name: 'supports_range_requests', type: 'BOOLEAN DEFAULT 0' },
      { name: 'filename', type: 'TEXT' },
      { name: 'cover_image_url', type: 'TEXT' }
    ];

    for (const column of missingColumns) {
      try {
        const sql = `ALTER TABLE cached_links ADD COLUMN ${column.name} ${column.type}`;
        await this.execute(sql);
      } catch (error) {
        // Column might already exist, ignore duplicate column errors
        if (!error.message.includes('duplicate column name')) {
          console.warn(`Failed to add column ${column.name}:`, error.message);
        }
      }
    }
  }

  /**
   * Migration method to add cover image columns to torrent-related tables
   */
  async migrateCoverImageColumns() {
    const tables = [
      {
        table: 'torrent_details',
        columns: [{ name: 'cover_image_url', type: 'TEXT' }]
      },
      {
        table: 'favorite_entries',
        columns: [{ name: 'cover_image_url', type: 'TEXT' }]
      }
    ];

    for (const { table, columns } of tables) {
      for (const column of columns) {
        try {
          const sql = `ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.type}`;
          await this.execute(sql);
        } catch (error) {
          // Column might already exist, ignore duplicate column errors
          if (!error.message.includes('duplicate column name')) {
            console.warn(`Failed to add column ${column.name} to ${table}:`, error.message);
          }
        }
      }
    }
  }

  /**
   * Execute a SQL query with retry logic
   */
  async execute(sql, params = []) {
    const maxRetries = this.config.maxRetries;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeTursoQuery(sql, params);
      } catch (error) {
        lastError = error;
        // Query attempt failed

        if (attempt < maxRetries) {
          await this.delay(this.config.retryDelay * attempt);
        }
      }
    }

    throw new Error(
      `Query failed after ${maxRetries} attempts: ${lastError.message}`
    );
  }

  /**
   * Get a single row
   */
  async get(sql, params = []) {
    const result = await this.executeTursoQuery(sql, params);
    const rows = result.result?.rows || [];
    const columns = result.result?.cols || [];

    if (rows.length === 0) return null;

    // Convert array row to object using column names
    const row = {};
    rows[0].forEach((value, index) => {
      if (columns[index]) {
        const colValue = value?.value !== undefined ? value.value : value;
        row[columns[index].name] = colValue;
      }
    });

    return row;
  }

  /**
   * Get all rows
   */
  async all(sql, params = []) {
    const result = await this.executeTursoQuery(sql, params);
    const rows = result.result?.rows || [];
    const columns = result.result?.cols || [];

    // Convert array rows to objects using column names
    return rows.map((row) => {
      const obj = {};
      row.forEach((value, index) => {
        if (columns[index]) {
          const colValue = value?.value !== undefined ? value.value : value;
          obj[columns[index].name] = colValue;
        }
      });
      return obj;
    });
  }

  /**
   * Run a query (INSERT, UPDATE, DELETE)
   */
  async run(sql, params = []) {
    const result = await this.executeTursoQuery(sql, params);
    return {
      changes: result.result?.affected_row_count || 0,
      lastID: result.result?.last_insert_rowid || null,
    };
  }

  /**
   * Begin a transaction
   */
  async beginTransaction() {
    await this.execute('BEGIN TRANSACTION');
  }

  /**
   * Commit a transaction
   */
  async commitTransaction() {
    await this.execute('COMMIT');
  }

  /**
   * Rollback a transaction
   */
  async rollbackTransaction() {
    await this.execute('ROLLBACK');
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction(queries) {
    try {
      await this.beginTransaction();

      const results = [];
      for (const { sql, params } of queries) {
        const result = await this.execute(sql, params);
        results.push(result);
      }

      await this.commitTransaction();
      return results;
    } catch (error) {
      await this.rollbackTransaction();
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    const stats = {};
    const queries = [
      { key: 'cache', sql: 'SELECT COUNT(*) as count FROM cache' },
      { key: 'images', sql: 'SELECT COUNT(*) as count FROM images' },
      { key: 'streamUrls', sql: 'SELECT COUNT(*) as count FROM stream_urls' },
      { key: 'favorites', sql: 'SELECT COUNT(*) as count FROM favorites' },
      { key: 'cachedLinks', sql: 'SELECT COUNT(*) as count FROM cached_links' },
      {
        key: 'favoriteEntries',
        sql: 'SELECT COUNT(*) as count FROM favorite_entries',
      },
      {
        key: 'torrentDetails',
        sql: 'SELECT COUNT(*) as count FROM torrent_details',
      },
      {
        key: 'favoriteScreenshots',
        sql: 'SELECT COUNT(*) as count FROM favorite_screenshots',
      },
    ];

    for (const { key, sql } of queries) {
      try {
        const result = await this.get(sql);
        stats[key] = result?.count || 0;
      } catch (error) {
        stats[key] = 0;
      }
    }

    stats.databaseType = 'Turso Cloud';
    stats.environment = this.config.environment;

    return stats;
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this.get('SELECT 1 as health');
      return {
        status: 'healthy',
        type: 'cloud',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        type: 'cloud',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Close database connection (no-op for HTTP API)
   */
  async close() {
    // No persistent connection to close with HTTP API
    return Promise.resolve();
  }

  /**
   * Utility method for delays
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = DatabaseManager;
