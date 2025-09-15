/**
 * Database abstraction layer for Turso cloud database
 * Provides connection pooling, retry logic, and optimized cloud database operations
 */
const { createClient } = require('@libsql/client');

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
    this.client = null;
  }

  /**
   * Initialize database connection
   */
  async initializeConnection() {
    try {
      this.client = createClient({
        url: this.config.tursoUrl,
        authToken: this.config.tursoAuthToken,
      });

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
    console.log('DatabaseManager: Starting schema initialization...');
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

      // Image URLs table for Pixhost-hosted images
      `CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        torrent_key TEXT NOT NULL,
        image_type TEXT NOT NULL,
        pixhost_url TEXT NOT NULL,
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
        user_id TEXT,
        added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      'CREATE INDEX IF NOT EXISTS idx_favorite_screenshots_entry_id ON favorite_screenshots(favorite_entry_id)',
      'CREATE INDEX IF NOT EXISTS idx_favorite_screenshots_timestamp ON favorite_screenshots(timestamp)',
      // Auth-related indexes
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)',
    ];

    // Execute schema creation
    console.log('DatabaseManager: Creating tables...');
    for (const sql of tables) {
      console.log(
        'DatabaseManager: Creating table:',
        sql.substring(0, 50) + '...'
      );
      await this.execute(sql);
    }

    console.log('DatabaseManager: Creating indexes...');
    for (const sql of indexes) {
      console.log(
        'DatabaseManager: Creating index:',
        sql.substring(0, 50) + '...'
      );
      await this.execute(sql);
    }

    console.log('DatabaseManager: Running migrations...');
    try {
      // Migration: Add missing columns to cached_links table
      console.log('DatabaseManager: Running migrateCachedLinksTable...');
      await this.migrateCachedLinksTable();

      // Migration: Add cover image columns to other tables
      console.log('DatabaseManager: Running migrateCoverImageColumns...');
      await this.migrateCoverImageColumns();

      // Migration: Update images table to use URLs only
      console.log('DatabaseManager: Running migrateImagesToUrlOnly...');
      await this.migrateImagesToUrlOnly();

      // Migration: Add user_id columns for user-specific data
      console.log('DatabaseManager: Running migrateUserColumns...');
      await this.migrateUserColumns();

      console.log('DatabaseManager: All migrations completed successfully');
    } catch (migrationError) {
      console.warn(
        'DatabaseManager: Migration failed, continuing without migrations:',
        migrationError.message
      );
      // Continue without migrations - tables and indexes are created
    }

    console.log(
      'DatabaseManager: Schema initialization completed successfully'
    );

    // Run migration to handle existing favorites without user_id
    await this.migrateFavoritesToUserSpecific();
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
   * Migration method to update images table to store URLs only
   */
  async migrateImagesToUrlOnly() {
    try {
      // Check if the pixhost_url column exists
      const hasPixhostUrl = await this.columnExists('images', 'pixhost_url');

      if (!hasPixhostUrl) {
        // Add pixhost_url column
        await this.execute('ALTER TABLE images ADD COLUMN pixhost_url TEXT');
        console.log('✅ Added pixhost_url column to images table');
      }

      // Check if we need to drop the image_data column
      const hasImageData = await this.columnExists('images', 'image_data');

      if (hasImageData) {
        // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
        const tempTableSql = `
          CREATE TABLE IF NOT EXISTS images_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            torrent_key TEXT NOT NULL,
            image_type TEXT NOT NULL,
            pixhost_url TEXT NOT NULL,
            original_url TEXT,
            torrent_name TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            metadata TEXT,
            UNIQUE(torrent_key, image_type)
          )
        `;

        await this.execute(tempTableSql);

        // Copy data from old table to new table (excluding image_data)
        const copyDataSql = `
          INSERT OR IGNORE INTO images_new (id, torrent_key, image_type, pixhost_url, original_url, torrent_name, created_at, metadata)
          SELECT id, torrent_key, image_type,
                 COALESCE(original_url, '') as pixhost_url,
                 original_url, torrent_name, created_at, metadata
          FROM images
        `;

        await this.execute(copyDataSql);

        // Drop old table and rename new table
        await this.execute('DROP TABLE images');
        await this.execute('ALTER TABLE images_new RENAME TO images');

        console.log('✅ Migrated images table to URL-only storage');
      }
    } catch (error) {
      console.warn('⚠️ Images table migration warning:', error.message);
    }
  }

  /**
   * Migration method to add user_id columns to existing tables
   */
  async migrateUserColumns() {
    const tables = ['favorites', 'cached_links', 'favorite_entries'];

    for (const tableName of tables) {
      try {
        const columnExists = await this.columnExists(tableName, 'user_id');
        if (!columnExists) {
          const sql = `ALTER TABLE ${tableName} ADD COLUMN user_id TEXT`;
          await this.execute(sql);
          console.log(`✅ Added user_id column to ${tableName} table`);
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

    // Add foreign key indexes for the new user_id columns
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id)',
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

  /**
   * Migration to handle existing favorites without user_id
   * This cleans up orphaned favorites that can't be associated with any user
   */
  async migrateFavoritesToUserSpecific() {
    try {
      console.log('DatabaseManager: Running favorites migration...');

      // Delete favorites and favorite_entries that don't have a user_id
      // These are likely from before user authentication was implemented
      const deleteFavorites = await this.run(
        'DELETE FROM favorites WHERE user_id IS NULL'
      );
      const deleteFavoriteEntries = await this.run(
        'DELETE FROM favorite_entries WHERE user_id IS NULL'
      );

      const deletedFavorites = deleteFavorites.changes || 0;
      const deletedEntries = deleteFavoriteEntries.changes || 0;

      if (deletedFavorites > 0 || deletedEntries > 0) {
        console.log(
          `DatabaseManager: Migration cleaned up ${deletedFavorites} orphaned favorites and ${deletedEntries} orphaned favorite entries`
        );
      } else {
        console.log(
          'DatabaseManager: No orphaned favorites found, migration complete'
        );
      }

      return true;
    } catch (error) {
      console.error('DatabaseManager: Migration error:', error);
      // Don't fail startup, just log the error
      return false;
    }
  }
}

module.exports = DatabaseManager;
