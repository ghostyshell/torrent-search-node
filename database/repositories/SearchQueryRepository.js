'use strict';

const BaseRepository = require('./BaseRepository');

/**
 * SearchQueryRepository
 * Persists every distinct search query (query + website + category) so the
 * background cache job knows which searches to keep warm in Redis.
 *
 * Each row records the query text, which scraper it ran against, which
 * category filter was active, a hit counter, and timestamps. Older-than-2-day
 * rows are deleted by the cache job at the end of every run.
 */
class SearchQueryRepository extends BaseRepository {
  /**
   * Insert a new query or bump its counter + last_queried_at on conflict.
   * @param {string} query    – raw search term (will be lower-cased and trimmed)
   * @param {string} website  – scraper name, e.g. "piratebay"
   * @param {string} category – category code, e.g. "507" (empty string = any)
   */
  async upsert(query, website = 'piratebay', category = '') {
    const normalized = (query || '').toLowerCase().trim();
    if (!normalized) return;
    await this.run(
      `INSERT INTO search_queries (query, website, category, query_count, last_queried_at, created_at)
       VALUES (?, ?, ?, 1, strftime('%s', 'now'), strftime('%s', 'now'))
       ON CONFLICT(query, website, category) DO UPDATE SET
         query_count    = query_count + 1,
         last_queried_at = strftime('%s', 'now')`,
      [normalized, website || 'piratebay', category || '']
    );
  }

  /**
   * Return all queries whose last_queried_at is within the retention window.
   * Ordered by hit count desc so high-traffic queries are refreshed first.
   * @param {number} days
   */
  async getRecentQueries(days = 2) {
    const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    return this.all(
      `SELECT * FROM search_queries
       WHERE last_queried_at >= ?
       ORDER BY query_count DESC, last_queried_at DESC`,
      [cutoff]
    );
  }

  /**
   * Delete all rows older than the retention window.
   * Returns the number of rows deleted.
   * @param {number} days
   */
  async deleteOldQueries(days = 2) {
    const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const result = await this.run(
      `DELETE FROM search_queries WHERE last_queried_at < ?`,
      [cutoff]
    );
    return result.changes || 0;
  }

  /** Total number of tracked queries. */
  async getCount() {
    const row = await this.get('SELECT COUNT(*) as count FROM search_queries');
    return Number(row?.count) || 0;
  }
}

module.exports = SearchQueryRepository;
