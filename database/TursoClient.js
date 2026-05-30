/**
 * Turso cloud database client
 * Provides connection pooling, retry logic, and optimized cloud database operations
 */
const { createClient } = require('@libsql/client');

class TursoClient {
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
    this.client = null;
  }

  /**
   * Initialize database connection
   */
  async initializeConnection() {
    try {
      console.log('TursoClient: Creating client with URL:', this.config.tursoUrl ? 'SET' : 'NOT SET');
      console.log('TursoClient: Auth token:', this.config.tursoAuthToken ? 'SET' : 'NOT SET');

      this.client = createClient({
        url: this.config.tursoUrl,
        authToken: this.config.tursoAuthToken,
      });

      console.log('TursoClient: Client created, testing connection...');
      await this.testTursoConnection();
      console.log('TursoClient: Connection test passed, initializing schema...');
      await this.initializeSchema();
      console.log('TursoClient: Schema initialized successfully');
    } catch (error) {
      console.error('TursoClient: Initialization failed:', error.message);
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
        await this.client.execute('SELECT 1 as test');
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

      // Image URLs table for S3 object storage covers
      `CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        torrent_key TEXT NOT NULL,
        image_type TEXT NOT NULL,
        pixhost_url TEXT NOT NULL,
        original_url TEXT,
        torrent_name TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        metadata TEXT,
        storage_key TEXT,
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
        filename TEXT,
        user_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // Favorite entries table - each favorite gets a unique entry
      `CREATE TABLE IF NOT EXISTS favorite_entries (
        id TEXT PRIMARY KEY,
        torrent_key TEXT NOT NULL,
        torrent_data TEXT NOT NULL,
        magnet_link TEXT,
        torrent_name TEXT,
        user_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        metadata TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(torrent_key, user_id)
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

      // Users table - stores user information from Google OAuth
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        picture TEXT,
        google_id TEXT NOT NULL UNIQUE,
        real_debrid_api_key TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_login_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        is_active BOOLEAN DEFAULT 1
      )`,

      // User sessions table - manage login sessions
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_token TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_accessed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        user_agent TEXT,
        ip_address TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      // Auth-related indexes
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)',
    ];

    // Execute schema creation

    for (const sql of tables) {

      await this.execute(sql);
    }

    for (const sql of indexes) {

      await this.execute(sql);
    }

    try {
      // Migration: Add missing columns to cached_links table

      await this.migrateCachedLinksTable();

      // Migration: Add cover image columns to other tables

      await this.migrateCoverImageColumns();

      // Migration: Add user_id columns for user-specific data
      await this.migrateUserColumns();

      // Migration: Add Google OAuth token columns to users table
      await this.migrateGoogleTokenColumns();

      // Migration: Add storage_key column to images table (object storage)
      await this.migrateImagesStorageKey();

    } catch (migrationError) {
      console.warn(
        'TursoClient: Migration failed, continuing without migrations:',
        migrationError.message
      );
      // Continue without migrations - tables and indexes are created
    }

  }

  /**
   * Migration method to add missing columns to cached_links table
   */
  async migrateCachedLinksTable() {
    const missingColumns = [
      { name: 'stream_url_cached_at', type: 'TEXT' },
      { name: 'supports_range_requests', type: 'BOOLEAN DEFAULT 0' },
      { name: 'filename', type: 'TEXT' },
      { name: 'cover_image_url', type: 'TEXT' },
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
        columns: [{ name: 'cover_image_url', type: 'TEXT' }],
      },
      {
        table: 'favorite_entries',
        columns: [{ name: 'cover_image_url', type: 'TEXT' }],
      },
    ];

    for (const { table, columns } of tables) {
      for (const column of columns) {
        try {
          const sql = `ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.type}`;
          await this.execute(sql);
        } catch (error) {
          // Column might already exist, ignore duplicate column errors
          if (!error.message.includes('duplicate column name')) {
            console.warn(
              `Failed to add column ${column.name} to ${table}:`,
              error.message
            );
          }
        }
      }
    }
  }

  /**
   * Migration method to add user_id columns to existing tables
   */
  async migrateUserColumns() {
    const tables = ['cached_links', 'favorite_entries'];

    for (const tableName of tables) {
      try {
        const columnExists = await this.columnExists(tableName, 'user_id');
        if (!columnExists) {
          const sql = `ALTER TABLE ${tableName} ADD COLUMN user_id TEXT`;
          await this.execute(sql);

        }
      } catch (error) {
        if (!error.message.includes('duplicate column name')) {
          console.warn(
            `⚠️ Failed to add user_id column to ${tableName}:`,
            error.message
          );
        }
      }
    }

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_cached_links_user_id ON cached_links(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_favorite_entries_user_id ON favorite_entries(user_id)',
    ];

    for (const indexSql of indexes) {
      try {
        await this.execute(indexSql);
      } catch (error) {
        console.warn('⚠️ Index creation warning:', error.message);
      }
    }
  }

  /**
   * Migration method to add Google OAuth token columns to users table
   */
  async migrateGoogleTokenColumns() {
    const columns = [
      { name: 'google_access_token', type: 'TEXT' },
      { name: 'google_refresh_token', type: 'TEXT' },
      { name: 'google_token_expires_at', type: 'INTEGER' },
    ];

    for (const column of columns) {
      try {
        const sql = `ALTER TABLE users ADD COLUMN ${column.name} ${column.type}`;
        await this.execute(sql);
      } catch (error) {
        // Column might already exist, ignore duplicate column errors
        if (!error.message.includes('duplicate column name')) {
          console.warn(
            `⚠️ Failed to add column ${column.name} to users:`,
            error.message
          );
        }
      }
    }
  }

  /**
   * Migration: add storage_key column to the images table. Holds the object
   * storage key so presigned cover URLs can be regenerated.
   */
  async migrateImagesStorageKey() {
    try {
      const exists = await this.columnExists('images', 'storage_key');
      if (!exists) {
        await this.execute('ALTER TABLE images ADD COLUMN storage_key TEXT');
      }
    } catch (error) {
      console.warn('⚠️ migrateImagesStorageKey warning:', error.message);
    }
  }

  /**
   * Helper method to check if a column exists in a table
   */
  async columnExists(tableName, columnName) {
    try {
      const result = await this.execute(`PRAGMA table_info(${tableName})`);
      return result.rows.some((row) => row.name === columnName);
    } catch (error) {
      console.warn(
        `Error checking column ${columnName} in ${tableName}:`,
        error.message
      );
      return false;
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
        return await this.client.execute(sql, params);
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
    if (!this.client) {
      throw new Error(
        'Database client not initialized. Call initializeConnection() first.'
      );
    }

    const result = await this.client.execute(sql, params);

    if (result.rows.length === 0) return null;

    // libsql client returns rows as objects, not arrays
    return result.rows[0];
  }

  /**
   * Get all rows
   */
  async all(sql, params = []) {
    if (!this.client) {
      throw new Error(
        'Database client not initialized. Call initializeConnection() first.'
      );
    }

    const result = await this.client.execute(sql, params);

    // libsql client returns rows as objects, return directly
    return result.rows;
  }

  /**
   * Run a query (INSERT, UPDATE, DELETE)
   */
  async run(sql, params = []) {
    if (!this.client) {
      throw new Error(
        'Database client not initialized. Call initializeConnection() first.'
      );
    }

    const result = await this.client.execute(sql, params);
    return {
      changes: result.rowsAffected || 0,
      lastID: result.lastInsertRowid || null,
    };
  }

  /**
   * Begin a transaction
   */
  async beginTransaction() {
    await this.client.execute('BEGIN TRANSACTION');
  }

  /**
   * Commit a transaction
   */
  async commitTransaction() {
    await this.client.execute('COMMIT');
  }

  /**
   * Rollback a transaction
   */
  async rollbackTransaction() {
    await this.client.execute('ROLLBACK');
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction(queries) {
    try {
      await this.beginTransaction();

      const results = [];
      for (const { sql, params } of queries) {
        const result = await this.client.execute(sql, params);
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
      { key: 'cachedLinks', sql: 'SELECT COUNT(*) as count FROM cached_links' },
      {
        key: 'favoriteEntries',
        sql: 'SELECT COUNT(*) as count FROM favorite_entries',
      },
      {
        key: 'torrentDetails',
        sql: 'SELECT COUNT(*) as count FROM torrent_details',
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
   * Close database connection
   */
  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    return Promise.resolve();
  }

  /**
   * Utility method for delays
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

}

module.exports = TursoClient;
