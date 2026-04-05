const pirateBay = require('./scrapers/pirateBay');
const logger = require('../middleware/logger');
const { STUDIOS } = require('./studioSearchTerms');

/**
 * Background job that pre-caches Real-Debrid stream URLs for torrents
 * appearing on the Pirate Bay browse homepage (category 507, sort by date, pages 1–6),
 * the first 2 pages of the "trans" common-search query (507, seeders sort),
 * plus the first 2 pages of each studio filter query.
 *
 * Works per-user: each user with an RD API key gets the magnets added to
 * their own RD account, so the cached stream links are valid for that user.
 *
 * Scrapes filter pages once, then processes every user's RD account
 * against the collected magnets.
 *
 * For each magnet, always calls Real-Debrid refresh (same as the favorites stream
 * URL job), even when a row exists in stream_urls — stored links may be expired.
 */

const PIRATEBAY_CATEGORY = '507'; // Porn HD
const PIRATEBAY_SORT = '7';       // Seeders desc (studio searches)
const BROWSE_SORT = '3';          // Date desc — matches /browse/507/{page}/3
const PAGES_BROWSE_HOME = 6;      // Pre-cache stream URLs for first 6 browse pages
const TRANS_QUERY = 'trans';
const PAGES_TRANS_CACHE = 2;      // Common-search preset (matches UI)
const PAGES_TO_CACHE = 2;         // Per studio search query
const MAX_ERRORS = 50;

class FilterStreamCacheService {
  /**
   * @param {object} storageProvider
   * @param {object} streamUrlRefreshService – initialised StreamUrlRefreshService
   * @param {object} authService – AuthService instance to look up per-user RD keys
   */
  constructor(storageProvider, streamUrlRefreshService, authService) {
    this.storage = storageProvider;
    this.refreshService = streamUrlRefreshService;
    this.authService = authService;
  }

  // ─── main entry ────────────────────────────────────────────────

  async runCacheJob() {
    const startTime = Date.now();
    const results = {
      totalSearches: 0,
      totalTorrents: 0,
      uniqueMagnets: 0,
      usersProcessed: 0,
      usersSkipped: 0,
      alreadyCached: 0,
      refreshed: 0,
      noMagnet: 0,
      failed: 0,
      errors: [],
    };

    logger.info(
      `🔗 [FilterStreamCache] Starting job (browse ${PAGES_BROWSE_HOME} pages + "${TRANS_QUERY}" ${PAGES_TRANS_CACHE} pages + ${PAGES_TO_CACHE} pages per studio query)`
    );

    // ── Step 1: scrape all filter pages once ──
    const magnets = await this.collectMagnets(results);

    if (magnets.length === 0) {
      logger.info('⚠️ [FilterStreamCache] No magnets collected — nothing to cache');
      return results;
    }

    results.uniqueMagnets = magnets.length;
    logger.info(`🔗 [FilterStreamCache] Collected ${magnets.length} unique magnets from ${results.totalSearches} searches`);

    // ── Step 2: get all users with RD keys ──
    const users = await this.authService.getUsersWithRealDebridKeys();

    if (!users || users.length === 0) {
      logger.warn('⚠️ [FilterStreamCache] No users with Real-Debrid API keys — skipping');
      return results;
    }

    logger.info(`👥 [FilterStreamCache] Processing ${users.length} user(s) with RD keys`);

    // ── Step 3: for each user, cache stream URLs ──
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const shortId = user.id ? user.id.substring(0, 8) + '...' : 'unknown';

      let apiKey = user.real_debrid_api_key;
      if (!apiKey) {
        results.usersSkipped++;
        continue;
      }

      // Decrypt if needed
      if (this.authService.decryptApiKey) {
        try {
          apiKey = this.authService.decryptApiKey(apiKey);
        } catch (e) {
          logger.warn(`❌ [FilterStreamCache] Failed to decrypt key for user ${shortId}`, { error: e.message });
          results.usersSkipped++;
          continue;
        }
      }

      logger.info(`👤 [FilterStreamCache] Processing user ${i + 1}/${users.length} (${shortId})`);
      results.usersProcessed++;

      await this.processUserMagnets(magnets, apiKey, results);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('✅ [FilterStreamCache] Job completed', {
      duration: `${duration}s`,
      ...this.summaryFromResults(results),
    });

    return results;
  }

  // ─── scraping ──────────────────────────────────────────────────

  /**
   * Scrape all filter pages and return a deduplicated list of
   * { magnetLink, magnetHash, torrentName } objects.
   */
  async collectMagnets(results) {
    const seen = new Set();
    const magnets = [];

    const addPage = async (query, page) => {
      results.totalSearches++;
      try {
        const torrents = await pirateBay(query, page, {
          sort: PIRATEBAY_SORT,
          category: PIRATEBAY_CATEGORY,
        });

        if (!torrents || torrents.length === 0) {
          logger.info(`[FilterStreamCache] No results for "${query}" page ${page}`);
          return;
        }

        logger.info(`[FilterStreamCache] "${query}" page ${page}: ${torrents.length} torrents`);
        results.totalTorrents += torrents.length;

        for (const t of torrents) {
          if (!t.Magnet) {
            results.noMagnet++;
            continue;
          }
          const hash = this.refreshService.extractMagnetHash(t.Magnet);
          if (!hash || seen.has(hash)) continue;
          seen.add(hash);
          magnets.push({ magnetLink: t.Magnet, magnetHash: hash, torrentName: t.Name || 'Unknown' });
        }

        await this.sleep(500);
      } catch (err) {
        results.failed++;
        this.pushError(results, { query, page, error: err.message });
        logger.warn(`⚠️ [FilterStreamCache] Scrape failed "${query}" page ${page}`, { error: err.message });
      }
    };

    const addBrowsePage = async (page) => {
      results.totalSearches++;
      try {
        const torrents = await pirateBay.browse(PIRATEBAY_CATEGORY, String(page), BROWSE_SORT, {});

        if (!torrents || torrents.length === 0) {
          logger.info(`[FilterStreamCache] No browse results page ${page}`);
          return;
        }

        logger.info(`[FilterStreamCache] browse/507/${page}/${BROWSE_SORT}: ${torrents.length} torrents`);
        results.totalTorrents += torrents.length;

        for (const t of torrents) {
          if (!t.Magnet) {
            results.noMagnet++;
            continue;
          }
          const hash = this.refreshService.extractMagnetHash(t.Magnet);
          if (!hash || seen.has(hash)) continue;
          seen.add(hash);
          magnets.push({ magnetLink: t.Magnet, magnetHash: hash, torrentName: t.Name || 'Unknown' });
        }

        await this.sleep(500);
      } catch (err) {
        results.failed++;
        this.pushError(results, { browse: true, page, error: err.message });
        logger.warn(`⚠️ [FilterStreamCache] Browse scrape failed page ${page}`, { error: err.message });
      }
    };

    // Homepage browse (thehiddenbay.com/browse/507/{page}/3)
    for (let p = 1; p <= PAGES_BROWSE_HOME; p++) await addBrowsePage(p);

    // Common-search preset "trans" — first 2 pages (same as UI ?preset=trans)
    for (let p = 1; p <= PAGES_TRANS_CACHE; p++) await addPage(TRANS_QUERY, p);

    // Studio name searches — Porn HD (507), same as other pirateBay jobs here
    for (const studio of STUDIOS) {
      for (let p = 1; p <= PAGES_TO_CACHE; p++) await addPage(studio, p);
    }

    return magnets;
  }

  // ─── per-user processing ───────────────────────────────────────

  async processUserMagnets(magnets, apiKey, results) {
    for (const { magnetLink, torrentName } of magnets) {
      const shortName = torrentName.substring(0, 60);

      try {
        // Always refresh via RD (like favorites job). Do not skip when stream_urls
        // has a row — the URL may be expired; setStreamUrl replaces the row on success.
        const result = await this.refreshService.refreshStreamUrl(magnetLink, apiKey, torrentName);

        if (result.success) {
          results.refreshed++;
          logger.info(`✅ [FilterStreamCache] Refreshed: ${shortName}`);
        } else if (result.skipped) {
          results.alreadyCached++;
        } else {
          results.failed++;
          this.pushError(results, { torrent: shortName, error: result.error });
          logger.warn(`❌ [FilterStreamCache] Failed: ${shortName} - ${result.error || 'Unknown'}`);
        }

        // Rate-limit RD API calls
        await this.sleep(1000);
      } catch (err) {
        results.failed++;
        this.pushError(results, { torrent: shortName, error: err.message });
        logger.warn(`❌ [FilterStreamCache] Exception: ${shortName}`, { error: err.message });
      }
    }
  }

  // ─── helpers ───────────────────────────────────────────────────

  summaryFromResults(r) {
    return {
      totalSearches: r.totalSearches,
      totalTorrents: r.totalTorrents,
      uniqueMagnets: r.uniqueMagnets,
      usersProcessed: r.usersProcessed,
      usersSkipped: r.usersSkipped,
      alreadyCached: r.alreadyCached,
      refreshed: r.refreshed,
      noMagnet: r.noMagnet,
      failed: r.failed,
    };
  }

  pushError(results, entry) {
    if (results.errors.length < MAX_ERRORS) {
      results.errors.push(entry);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FilterStreamCacheService;
