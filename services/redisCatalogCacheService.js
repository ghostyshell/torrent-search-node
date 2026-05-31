'use strict';

/**
 * redisCatalogCacheService.js
 *
 * Background job that pre-populates Redis with catalog torrent lists so the
 * Stremio addon never has to hit thehiddenbay.com on a cold load.
 *
 * Key format mirrors the Stremio addon's catalog.js exactly:
 *   cat:v1:{selfUrl}|{catalogId}|movie||0
 *
 * Data format is the same normalised camelCase torrent array that the addon
 * stores after fetchCatalogTorrents → normalizeHbTorrent → dedup → sort, so
 * the addon can consume a Redis hit without any further transformation.
 *
 * Required env vars:
 *   REDIS_URL      – Redis connection URL  (same as the addon's REDIS_URL)
 *   REDIS_PASSWORD – optional password     (same as the addon's REDIS_PASSWORD)
 *   BASE_URL       – this service's public URL, must match the addon users'
 *                    backendUrl setting (e.g. https://stream-backend.sliplane.app)
 */

const pirateBay = require('./scrapers/pirateBay');
const { STUDIOS } = require('./studioSearchTerms');
const logger = require('../middleware/logger');

// ── Redis client ──────────────────────────────────────────────────────────────

let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;
  if (!process.env.REDIS_URL) return null;
  const Redis = require('ioredis');
  const opts = {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
  };
  if (process.env.REDIS_PASSWORD) opts.password = process.env.REDIS_PASSWORD;
  redisClient = new Redis(process.env.REDIS_URL, opts);
  redisClient.on('connect', () => logger.info('[redisCatalog] Redis connected'));
  redisClient.on('error',   (e) => logger.warn('[redisCatalog] Redis error: ' + e.message));
  return redisClient;
}

// ── Catalog definitions (must mirror adultSections.js in the Stremio addon) ──

const CATEGORIES = [
  { marker: '',    label: '4K',    category: '507' },
  { marker: 'fhd', label: '1080p', category: '505' },
];

const SORT_VARIANTS = [
  { suffix: 'top',    sort: '7' }, // seeders desc
  { suffix: 'recent', sort: '3' }, // newest first
];

// Replicated from adultSections.js studioSafeId()
function studioSafeId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

// ── Normalisation (mirrors normalizeHbTorrent in catalog.js) ─────────────────

function extractInfoHash(magnet) {
  if (!magnet) return '';
  const m = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return m ? m[1].toLowerCase() : '';
}

function normalizeHbTorrent(t) {
  const magnetLink = t.MagnetLink || t.magnetLink || t.Magnet || t.magnet || '';
  const torrentUrl = t.TorrentURL || t.torrentUrl || t.Url    || t.url    || '';
  const cover      = t.CoverImage || t.coverImage || null;
  const coverImage = (cover && (cover.url || cover.URL)) || '';
  return {
    title:      t.Name       || t.name       || '',
    size:       t.Size       || t.size       || '',
    seeders:    parseInt(t.Seeders  ?? t.seeders)  || 0,
    leechers:   parseInt(t.Leechers ?? t.leechers) || 0,
    infoHash:   extractInfoHash(magnetLink),
    magnetLink, torrentUrl, coverImage,
    website: 'hiddenbay', indexer: 'hiddenbay', quality: '',
  };
}

function dedupeAndSort(torrents, sort) {
  const seen = new Set();
  const out = torrents.filter((t) => {
    const key = t.infoHash || t.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (sort === '7') out.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
  return out;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function buildRedisKey(selfUrl, catalogId) {
  // Matches catalog.js: `cat:v1:${cfg.backendUrl}|${catalogId}|${type}|${searchQ}|${skip}`
  return `cat:v1:${selfUrl}|${catalogId}|movie||0`;
}

async function cacheEntry(redis, selfUrl, catalogId, rawTorrents, sort) {
  if (!rawTorrents || !rawTorrents.length) return 0;
  const normalised = rawTorrents.map(normalizeHbTorrent);
  const torrents   = dedupeAndSort(normalised, sort);
  if (!torrents.length) return 0;
  // 25–35 min TTL with jitter — same formula as the Stremio addon
  const ttl = 1800 + Math.floor(Math.random() * 600) - 300;
  const key = buildRedisKey(selfUrl, catalogId);
  try {
    await redis.set(key, JSON.stringify(torrents), 'EX', ttl);
    return torrents.length;
  } catch (e) {
    logger.warn(`[redisCatalog] Redis write failed for ${catalogId}: ${e.message}`);
    return 0;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Main job ──────────────────────────────────────────────────────────────────

class RedisCatalogCacheService {
  constructor() {
    this.selfUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  }

  async runJob() {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('[redisCatalog] REDIS_URL not set — skipping catalog cache job');
      return { skipped: true };
    }
    if (!this.selfUrl) {
      logger.warn('[redisCatalog] BASE_URL not set — cannot build cache keys, skipping');
      return { skipped: true };
    }

    const start   = Date.now();
    let cached    = 0;
    let errors    = 0;

    logger.info('[redisCatalog] Starting catalog cache job');

    for (const { marker, label, category } of CATEGORIES) {
      const qSuffix = marker ? `_${marker}` : '';

      // ── Browse (XXX) ──────────────────────────────────────────────────────
      for (const { suffix, sort } of SORT_VARIANTS) {
        const catalogId = `xxx${qSuffix}_${suffix}`;
        try {
          const raw = await pirateBay.browse(category, '1', sort, {});
          cached += await cacheEntry(redis, this.selfUrl, catalogId, raw, sort);
        } catch (e) {
          errors++;
          logger.warn(`[redisCatalog] browse ${catalogId}: ${e.message}`);
        }
        await sleep(500);
      }

      // ── Trans search ──────────────────────────────────────────────────────
      for (const { suffix, sort } of SORT_VARIANTS) {
        const catalogId = `xxx_trans${qSuffix}_${suffix}`;
        try {
          const raw = await pirateBay('trans', '1', { sort, category });
          cached += await cacheEntry(redis, this.selfUrl, catalogId, raw, sort);
        } catch (e) {
          errors++;
          logger.warn(`[redisCatalog] trans ${catalogId}: ${e.message}`);
        }
        await sleep(500);
      }

      // ── Studios ───────────────────────────────────────────────────────────
      for (const studio of STUDIOS) {
        const slug = studioSafeId(studio);
        for (const { suffix, sort } of SORT_VARIANTS) {
          const catalogId = `xxx_studio_${slug}${qSuffix}_${suffix}`;
          try {
            const raw = await pirateBay(studio, '1', { sort, category });
            cached += await cacheEntry(redis, this.selfUrl, catalogId, raw, sort);
          } catch (e) {
            errors++;
          }
          await sleep(400);
        }
      }
    }

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    logger.info(`[redisCatalog] Job done — ${cached} torrents cached, ${errors} errors, ${duration}s`);
    return { cached, errors, duration: parseFloat(duration) };
  }
}

module.exports = RedisCatalogCacheService;
