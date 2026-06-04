'use strict';

/**
 * mongoMigrationService.js
 *
 * One-shot, manually-triggered migration of all Turso (libSQL) data into
 * MongoDB. Reads each table in batches and bulk-upserts the rows into the
 * matching Mongo collection (keyed by a deterministic _id), so the job is
 * idempotent and safe to re-run — re-running simply refreshes Mongo with the
 * latest Turso state.
 *
 * Read-only on Turso; the only writes are upserts into Mongo. Progress is
 * logged through the standard logger so the dashboard's job-log panel can tail
 * it live.
 */

const { deriveId } = require('../database/MongoClient');
const logger = require('../middleware/logger');

// Tables to migrate, with a stable ORDER BY column for batch pagination.
const TABLES = [
  { table: 'cache',            orderBy: 'key' },
  { table: 'images',           orderBy: 'id' },
  { table: 'stream_urls',      orderBy: 'magnet_hash' },
  { table: 'cached_links',     orderBy: 'id' },
  { table: 'favorite_entries', orderBy: 'id' },
  { table: 'torrent_details',  orderBy: 'id' },
  { table: 'users',            orderBy: 'id' },
  { table: 'user_sessions',    orderBy: 'id' },
  { table: 'search_queries',   orderBy: 'id' },
];

class MongoMigrationService {
  constructor(storageProvider, mongoClient) {
    this.turso = storageProvider && storageProvider.tursoClient;
    this.mongo = mongoClient;
  }

  async runJob({ batchSize = 500 } = {}) {
    if (!this.turso) throw new Error('Turso client unavailable');
    if (!this.mongo || !this.mongo.isConnected) {
      throw new Error('MongoDB is not connected — set MONGODB_URI and restart the server');
    }

    const t0 = Date.now();
    const stats = { tables: {}, totalCopied: 0, errors: [] };
    logger.info('[mongoMigration] Job started');

    for (const { table, orderBy } of TABLES) {
      try {
        const copied = await this.migrateTable(table, orderBy, batchSize);
        stats.tables[table] = copied;
        stats.totalCopied += copied;
      } catch (err) {
        stats.errors.push({ table, error: err.message });
        logger.warn(`[mongoMigration] ${table} failed: ${err.message}`);
      }
    }

    const duration = ((Date.now() - t0) / 1000).toFixed(1);
    stats.durationSeconds = Number(duration);
    logger.info(`[mongoMigration] Done in ${duration}s`, {
      totalCopied: stats.totalCopied,
      tables: stats.tables,
      errors: stats.errors.length,
    });
    return stats;
  }

  /**
   * Copy one table into its Mongo collection, batching to bound memory.
   * @returns {Promise<number>} rows copied
   */
  async migrateTable(table, orderBy, batchSize) {
    const coll = this.mongo.collection(table);

    let total = 0;
    try {
      const r = await this.turso.execute(`SELECT COUNT(*) as count FROM ${table}`);
      total = Number(r.rows?.[0]?.count) || 0;
    } catch (_) { /* table may not exist on older DBs */ }

    logger.info(`[mongoMigration] ${table}: ${total} rows to copy`);

    let offset = 0;
    let copied = 0;

    for (;;) {
      const result = await this.turso.execute(
        `SELECT * FROM ${table} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [batchSize, offset]
      );
      const rows = result.rows || [];
      if (rows.length === 0) break;

      // libsql rows support named access; rebuild plain docs with column names.
      const columns = result.columns || Object.keys(rows[0] || {});
      const ops = [];
      for (const row of rows) {
        const doc = {};
        for (const col of columns) doc[col] = row[col];
        doc._id = deriveId(table, doc);
        if (doc._id === undefined || doc._id === null || doc._id === 'undefined') continue;
        ops.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
      }

      if (ops.length) await coll.bulkWrite(ops, { ordered: false });

      copied += rows.length;
      offset += rows.length;
      logger.info(`[mongoMigration] ${table}: ${copied}/${total} copied`);

      if (rows.length < batchSize) break;
    }

    return copied;
  }
}

module.exports = MongoMigrationService;
