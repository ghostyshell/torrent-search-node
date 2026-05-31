'use strict';

/**
 * searchQueryCacheService.js
 *
 * Background job that keeps Redis and cover-image storage warm for every
 * search query recorded in the last 2 days.
 *
 * Per run (every 2 hours):
 *   1. Load all recent queries from the search_queries table.
 *   2. For each query × quality tier (4K / 1080p):
 *      a. Scrape the first page of pirateBay results.
 *      b. For each torrent without a cached cover: fetch the details page,
 *         extract an image, and store it via setCoverImage (uploads to S3).
 *      c. Write the normalised results to Redis:
 *           - sqc:v1:{website}:{category}:{query}   (backend-specific key, 2 h TTL)
 *           - cat:v1:{BASE_URL}|{catalogId}|movie|{query}|0  (Stremio addon key)
 *   3. Delete search_queries rows older than 2 days.
 *
 * Redis key formats:
 *   sqc:v1:{website}:{category}:{encodedQuery}
 *     The canonical key for this job. TTL = 2 h.
 *
 *   cat:v1:{BASE_URL}|xxx_top|movie|{query}|0        (4K tier, sort=seeders)
 *   cat:v1:{BASE_URL}|xxx_fhd_top|movie|{query}|0   (1080p tier, sort=seeders)
 *     Written only when BASE_URL is set; consumed directly by the Stremio addon
 *     so searched catalogs are served from Redis instead of re-scraping.
 */

const pirateBay = require('./scrapers/pirateBay');
const logger    = require('../middleware/logger');

const REDIS_TTL           = 2 * 60 * 60;  // 2 hours
const QUERY_RETENTION_DAYS = 2;
const SORT_SEEDERS        = '7';
const SLEEP_BETWEEN_COVERS = 300;          // ms between cover fetches per torrent
const SLEEP_BETWEEN_QUERIES = 1500;        // ms between queries (rate-limit scraper)
const SLEEP_BETWEEN_PAGES   = 500;

// Process both quality tiers for every query.
const CATEGORIES = [
  { category: '507', label: '4K',    catalogSuffix: ''    },  // xxx_top
  { category: '505', label: '1080p', catalogSuffix: '_fhd' }, // xxx_fhd_top
];

// ── Redis client (lazy, optional) ─────────────────────────────────────────────

let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  if (!process.env.REDIS_URL) return null;
  const Redis = require('ioredis');
  const opts = { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 5000 };
  if (process.env.REDIS_PASSWORD) opts.password = process.env.REDIS_PASSWORD;
  _redis = new Redis(process.env.REDIS_URL, opts);
  _redis.on('connect', () => logger.info('[searchQueryCache] Redis connected'));
  _redis.on('error',   (e) => logger.warn('[searchQueryCache] Redis error: ' + e.message));
  return _redis;
}

// ── Normalisation (mirrors normalizeHbTorrent in the Stremio addon's catalog.js) ─

function extractInfoHash(magnet) {
  if (!magnet) return '';
  const m = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return m ? m[1].toLowerCase() : '';
}

function normalizeTorrent(t) {
  const magnetLink = t.MagnetLink || t.Magnet || t.magnet || '';
  const torrentUrl = t.TorrentURL || t.Url    || t.url    || '';
  return {
    title:     t.Name    || t.name    || '',
    size:      t.Size    || t.size    || '',
    seeders:   parseInt(t.Seeders  ?? t.seeders)  || 0,
    leechers:  parseInt(t.Leechers ?? t.leechers) || 0,
    infoHash:  extractInfoHash(magnetLink),
    magnetLink, torrentUrl,
    coverImage: '',
    website: 'hiddenbay', indexer: 'hiddenbay', quality: '',
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Service class ─────────────────────────────────────────────────────────────

class SearchQueryCacheService {
  constructor(storageProvider) {
    this.storage = storageProvider;
    this.selfUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  }

  // ── Main entry point ────────────────────────────────────────────────────────

  async runJob() {
    const t0 = Date.now();
    const stats = {
      queriesFound:     0,
      queriesProcessed: 0,
      totalTorrents:    0,
      coversFound:      0,
      coversCached:     0,
      redisEntries:     0,
      cleanedUp:        0,
      errors:           [],
    };

    logger.info('[searchQueryCache] Job started');

    // 1. Fetch recent queries
    const rows = await this.storage.searchQueries.getRecentQueries(QUERY_RETENTION_DAYS);
    stats.queriesFound = rows.length;
    logger.info(`[searchQueryCache] ${rows.length} queries in last ${QUERY_RETENTION_DAYS} days`);

    for (const row of rows) {
      const query   = row.query;
      const website = row.website || 'piratebay';

      // If the stored category matches a known tier, only process that one.
      // Otherwise process all tiers.
      const tiers = row.category
        ? CATEGORIES.filter(c => c.category === row.category)
        : CATEGORIES;

      for (const tier of tiers) {
        try {
          await this.processQuery(query, website, tier, stats);
        } catch (err) {
          stats.errors.push({ query, category: tier.category, error: err.message });
          logger.warn(`[searchQueryCache] "${query}" ${tier.label} failed: ${err.message}`);
        }
        await sleep(SLEEP_BETWEEN_QUERIES);
      }

      stats.queriesProcessed++;
      await sleep(SLEEP_BETWEEN_PAGES);
    }

    // 2. Delete stale query rows
    stats.cleanedUp = await this.storage.searchQueries.deleteOldQueries(QUERY_RETENTION_DAYS);
    if (stats.cleanedUp > 0) {
      logger.info(`[searchQueryCache] Removed ${stats.cleanedUp} stale query rows`);
    }

    const duration = ((Date.now() - t0) / 1000).toFixed(1);
    logger.info(`[searchQueryCache] Done in ${duration}s`, {
      queriesProcessed: stats.queriesProcessed,
      totalTorrents:    stats.totalTorrents,
      coversCached:     stats.coversCached,
      redisEntries:     stats.redisEntries,
      cleanedUp:        stats.cleanedUp,
      errors:           stats.errors.length,
    });

    return stats;
  }

  // ── Per-query / per-tier processing ────────────────────────────────────────

  async processQuery(query, website, tier, stats) {
    const { category, label, catalogSuffix } = tier;
    logger.info(`[searchQueryCache] "${query}" ${label} (cat ${category})`);

    const rawTorrents = await pirateBay(query, 1, { sort: SORT_SEEDERS, category });
    if (!rawTorrents || !rawTorrents.length) {
      logger.info(`[searchQueryCache] No results for "${query}" ${label}`);
      return;
    }

    stats.totalTorrents += rawTorrents.length;

    // Normalise and enrich with covers
    const enriched = [];
    for (const torrent of rawTorrents) {
      const norm = normalizeTorrent(torrent);
      norm.coverImage = await this.resolveCover(torrent, stats);
      enriched.push(norm);
      await sleep(SLEEP_BETWEEN_COVERS);
    }

    // Deduplicate and sort by seeders
    const seen = new Set();
    const deduped = enriched.filter(t => {
      const key = t.infoHash || t.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));

    await this.writeToRedis(query, website, category, catalogSuffix, deduped, stats);
  }

  // ── Cover resolution ────────────────────────────────────────────────────────

  /**
   * Return a cover URL for a torrent. Checks storage first; falls back to
   * scraping the details page and uploading to S3.
   */
  async resolveCover(torrent, stats) {
    // Check if already stored (S3 / favorite / cached-link)
    try {
      const existing = await this.storage.images.getCoverImage(torrent);
      if (existing) {
        return existing.imageUrl || existing.originalUrl || '';
      }
    } catch (_) {}

    if (!torrent.Url) return '';

    // Scrape details page for images
    try {
      const details = await pirateBay.getDetails(torrent.Url);
      if (!details.images || !details.images.length) return '';

      stats.coversFound++;

      const firstThree = details.images.slice(0, 3);
      const picked     = firstThree[Math.floor(Math.random() * firstThree.length)];
      let   imageUrl   = picked.directUrl || picked.originalUrl;
      if (!imageUrl) return '';

      imageUrl = this.getHigherResolutionUrl(imageUrl);

      const ok = await this.storage.images.setCoverImage(torrent, imageUrl);
      if (ok) {
        stats.coversCached++;
        // Re-fetch to get the final presigned URL from storage
        const stored = await this.storage.images.getCoverImage(torrent);
        return stored?.imageUrl || stored?.originalUrl || imageUrl;
      }
      return imageUrl;
    } catch (err) {
      logger.warn(`[searchQueryCache] Cover failed for "${torrent.Name}": ${err.message}`);
      return '';
    }
  }

  // ── Redis writes ────────────────────────────────────────────────────────────

  async writeToRedis(query, website, category, catalogSuffix, torrents, stats) {
    const redis = getRedis();
    if (!redis) return;

    const payload = JSON.stringify(torrents);

    // 1. Backend-specific key
    const sqcKey = `sqc:v1:${website}:${category}:${encodeURIComponent(query)}`;
    try {
      await redis.set(sqcKey, payload, 'EX', REDIS_TTL);
      stats.redisEntries++;
      logger.info(`[searchQueryCache] Redis sqc: "${query}" ${category} → ${torrents.length} results (TTL ${REDIS_TTL}s)`);
    } catch (e) {
      logger.warn(`[searchQueryCache] Redis sqc: write failed for "${query}" ${category}: ${e.message}`);
    }

    // 2. Stremio addon catalog key — only when BASE_URL is configured.
    //    Matches the key the addon builds for a user search on the xxx_top / xxx_fhd_top catalog.
    if (this.selfUrl) {
      const catalogId = `xxx${catalogSuffix}_top`;
      const catKey    = `cat:v1:${this.selfUrl}|${catalogId}|movie|${query}|0`;
      try {
        await redis.set(catKey, payload, 'EX', REDIS_TTL);
        stats.redisEntries++;
        logger.info(`[searchQueryCache] Redis cat: "${query}" → ${catalogId}`);
      } catch (e) {
        logger.warn(`[searchQueryCache] Redis cat: write failed for "${query}" ${catalogId}: ${e.message}`);
      }
    }
  }

  // ── Image URL helpers (mirrors descriptionImageCacheService) ────────────────

  getHigherResolutionUrl(url) {
    try {
      if (url.includes('trafficimage.club')) return url.replace(/\.md(\.[^.]+)$/, '$1');
      if (url.includes('postimg.cc'))        return url.replace(/\/[st]\d+x\d+\//, '/').replace(/_thumb\./, '.').replace(/\?[^=]*thumb[^=]*=[^&]*(&|$)/, '');
      if (url.includes('ibb.co'))            return url.replace(/\/[st]\d+x\d+\//, '/');
      if (url.includes('imgur.com'))         return url.replace(/[sbtlmh]\.jpg$/, '.jpg').replace(/\.jpg$/, 'h.jpg');
      if (url.includes('fastpic.org'))       return url.replace(/\/thumbs\//, '/big/');
      return url
        .replace(/\.md(\.[^.]+)$/, '$1')
        .replace(/_thumb(\.[^.]+)$/, '$1')
        .replace(/_small(\.[^.]+)$/, '$1')
        .replace(/_medium(\.[^.]+)$/, '$1')
        .replace(/\.thumb(\.[^.]+)$/, '$1');
    } catch { return url; }
  }
}

module.exports = SearchQueryCacheService;
