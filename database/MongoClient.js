/**
 * MongoClient — connection wrapper for the MongoDB backend.
 *
 * Owns the driver connection, exposes collection accessors, ensures the unique
 * + lookup indexes, and reports stats/health. Documents use snake_case field
 * names and a deterministic `_id` per collection (set by the repositories).
 */
'use strict';

const { MongoClient: Driver } = require('mongodb');

// All collections used by the app.
const COLLECTIONS = [
  'cache',
  'images',
  'stream_urls',
  'cached_links',
  'favorite_entries',
  'torrent_details',
  'users',
  'user_sessions',
  'search_queries',
];

class MongoClient {
  constructor(config = {}) {
    this.uri = config.uri || '';
    this.dbName = config.dbName || 'torrent_search';
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  /** Whether a connection string is configured at all. */
  isConfigured() {
    return !!this.uri;
  }

  /**
   * Connect and ensure indexes. Safe to call once at startup.
   */
  async initializeConnection() {
    if (this.isConnected) return this;
    if (!this.uri) throw new Error('MongoClient: no connection URI configured');

    this.client = new Driver(this.uri, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 10,
    });
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    await this.db.command({ ping: 1 });
    this.isConnected = true;
    await this.ensureIndexes();
    return this;
  }

  /** Return a collection handle (throws if not connected). */
  collection(name) {
    if (!this.db) throw new Error('MongoClient: not connected. Call initializeConnection() first.');
    return this.db.collection(name);
  }

  /**
   * Create indexes mirroring the SQLite UNIQUE constraints + hot query paths.
   * All are idempotent. `_id` already covers each table's primary key, so these
   * are the secondary/compound uniques and lookup indexes.
   */
  async ensureIndexes() {
    const idx = [
      ['cache',            { expires_at: 1 }, {}],
      ['images',           { torrent_key: 1, image_type: 1 }, { unique: true }],
      ['images',           { torrent_key: 1 }, {}],
      ['stream_urls',      { last_accessed_at: 1 }, {}],
      ['stream_urls',      { created_at: 1 }, {}],
      ['cached_links',     { user_id: 1 }, {}],
      ['cached_links',     { date_added: 1 }, {}],
      ['favorite_entries', { torrent_key: 1, user_id: 1 }, { unique: true }],
      ['favorite_entries', { user_id: 1, created_at: -1 }, {}],
      ['favorite_entries', { torrent_key: 1 }, {}],
      ['torrent_details',  { favorite_entry_id: 1, source: 1 }, { unique: true }],
      ['torrent_details',  { favorite_entry_id: 1 }, {}],
      ['users',            { email: 1 }, { unique: true }],
      ['users',            { google_id: 1 }, { unique: true }],
      ['user_sessions',    { session_token: 1 }, { unique: true }],
      ['user_sessions',    { user_id: 1 }, {}],
      ['user_sessions',    { expires_at: 1 }, {}],
      ['search_queries',   { query: 1, website: 1, category: 1 }, { unique: true }],
      ['search_queries',   { last_queried_at: 1 }, {}],
    ];

    for (const [coll, keys, opts] of idx) {
      try {
        await this.db.collection(coll).createIndex(keys, opts);
      } catch (err) {
        // Don't fail startup on a single index (e.g. a pre-existing duplicate);
        // log and continue so the rest of the app keeps working.
        console.warn(`MongoClient: index on ${coll} ${JSON.stringify(keys)} failed: ${err.message}`);
      }
    }
  }

  /** Per-collection document counts, plus type. */
  async getStats() {
    const stats = {};
    const keyMap = {
      cache: 'cache',
      images: 'images',
      stream_urls: 'streamUrls',
      cached_links: 'cachedLinks',
      favorite_entries: 'favoriteEntries',
      torrent_details: 'torrentDetails',
      search_queries: 'searchQueries',
      users: 'users',
      user_sessions: 'userSessions',
    };
    for (const coll of COLLECTIONS) {
      try {
        stats[keyMap[coll] || coll] = await this.db.collection(coll).estimatedDocumentCount();
      } catch (_) {
        stats[keyMap[coll] || coll] = 0;
      }
    }
    stats.databaseType = 'MongoDB';
    return stats;
  }

  async healthCheck() {
    try {
      await this.db.command({ ping: 1 });
      return { status: 'healthy', type: 'mongodb', timestamp: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', type: 'mongodb', error: error.message, timestamp: new Date().toISOString() };
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.isConnected = false;
    }
  }
}

module.exports = MongoClient;
module.exports.COLLECTIONS = COLLECTIONS;
