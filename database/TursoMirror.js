'use strict';

/**
 * TursoMirror — dual-write replication into Turso.
 *
 * When the MongoDB experiment is on, the Mongo repositories are the source of
 * truth for reads and writes; this mirror keeps Turso a faithful hot-standby so
 * the experiment can be rolled back instantly (flip EXPERIMENT_MONGODB off).
 *
 * The mirror replays the *result* of a Mongo write as a generic
 * `INSERT OR REPLACE` / `DELETE` against the matching Turso table. Because the
 * migrated Mongo documents use the same snake_case field names as the SQLite
 * columns, this is table-agnostic. Mirror failures are logged and swallowed —
 * Mongo is primary, so a transient Turso hiccup must not fail a user request
 * (Turso may briefly drift; it's the standby, not the live copy).
 */

const logger = require('../middleware/logger');

// Tables whose `id` is an AUTOINCREMENT surrogate. Never mirror it — let SQLite
// assign its own; the row's identity is its other UNIQUE constraint.
const AUTOINCREMENT_ID_TABLES = new Set(['images', 'torrent_details', 'search_queries']);

function normalizeValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

class TursoMirror {
  constructor(tursoClient) {
    this.turso = tursoClient;
  }

  /**
   * Upsert a document (as produced for Mongo) into `table` by INSERT OR REPLACE.
   * Strips `_id` and, for autoincrement tables, the surrogate `id`.
   */
  async upsert(table, doc) {
    if (!doc) return;
    try {
      const row = { ...doc };
      delete row._id;
      if (AUTOINCREMENT_ID_TABLES.has(table)) delete row.id;

      const cols = Object.keys(row);
      if (cols.length === 0) return;

      const placeholders = cols.map(() => '?').join(', ');
      const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
      await this.turso.run(sql, cols.map((c) => normalizeValue(row[c])));
    } catch (err) {
      logger.warn(`[tursoMirror] upsert ${table} failed: ${err.message}`);
    }
  }

  /**
   * Delete rows from `table` matching a simple equality filter.
   * `null` values become `IS NULL`.
   */
  async delete(table, where) {
    try {
      const cols = Object.keys(where);
      const clause = cols
        .map((c) => (where[c] === null || where[c] === undefined ? `${c} IS NULL` : `${c} = ?`))
        .join(' AND ');
      const params = cols
        .filter((c) => where[c] !== null && where[c] !== undefined)
        .map((c) => normalizeValue(where[c]));
      await this.turso.run(`DELETE FROM ${table} WHERE ${clause}`, params);
    } catch (err) {
      logger.warn(`[tursoMirror] delete ${table} failed: ${err.message}`);
    }
  }

  /** Escape hatch: run an arbitrary mirrored statement (e.g. conditional cleanup). */
  async run(sql, params = []) {
    try {
      await this.turso.run(sql, params.map(normalizeValue));
    } catch (err) {
      logger.warn(`[tursoMirror] run failed: ${err.message}`);
    }
  }
}

module.exports = TursoMirror;
