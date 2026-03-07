const pirateBay = require('./scrapers/pirateBay');
const logger = require('../middleware/logger');

const STUDIOS = [
  'OnlyFans', 'Vixen', 'PureMature', 'Evil Angel', 'Bang Rammed',
  'Bang PrettyAndRaw', 'BigTitCreampie', 'Wifey', 'BangBros', 'Blacked',
  'BrazzersExxtra', 'MyFriendsHotMom', 'DeepLush', 'Milfy', 'Lubed',
  'GenderX', 'DigitalPlayground', 'AssParade', 'Tushy', 'TushyRaw',
  'SexArt', 'BlacksOnBlondes', 'XVideosRED',
];

const PIRATEBAY_CATEGORY = '507'; // Porn HD
const PIRATEBAY_SORT = '7';       // Seeders desc
const HOME_QUERY = 'xxx';
const PAGES_TO_CACHE = 5;
const MAX_ERRORS = 30;

class DescriptionImageCacheService {
  constructor(storageProvider) {
    this.storage = storageProvider;
  }

  /**
   * Main cache job: home page + all studio pages
   */
  async runCacheJob() {
    const startTime = Date.now();
    const results = {
      totalSearches: 0,
      totalTorrents: 0,
      imagesFound: 0,
      cached: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      // Tracks image URLs already stored this run so shared uploader banners/logos
      // don't get written to every result — each torrent gets its own unique image.
      usedImageUrls: new Set(),
    };

    logger.info('🖼️ [DescImageCache] Starting description/image cache job');

    // 1. Home page "xxx" query — pages 1-5
    logger.info(`🔍 [DescImageCache] Processing home query "${HOME_QUERY}" (${PAGES_TO_CACHE} pages)`);
    for (let page = 1; page <= PAGES_TO_CACHE; page++) {
      await this.processSearchPage(HOME_QUERY, page, results);
    }

    // 2. Each studio — pages 1-5 (empty base query, studio as the search term)
    for (const studio of STUDIOS) {
      logger.info(`🎬 [DescImageCache] Processing studio "${studio}" (${PAGES_TO_CACHE} pages)`);
      for (let page = 1; page <= PAGES_TO_CACHE; page++) {
        await this.processSearchPage(studio, page, results);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('✅ [DescImageCache] Job completed', {
      duration: `${duration}s`,
      totalSearches: results.totalSearches,
      totalTorrents: results.totalTorrents,
      imagesFound: results.imagesFound,
      cached: results.cached,
      skipped: results.skipped,
      failed: results.failed,
    });

    // Don't expose the internal Set to callers
    const { usedImageUrls, ...publicResults } = results;
    return publicResults;
  }

  /**
   * Fetch one page of piratebay results and process each torrent
   */
  async processSearchPage(query, page, results) {
    results.totalSearches++;
    try {
      const torrents = await pirateBay(query, page, {
        sort: PIRATEBAY_SORT,
        category: PIRATEBAY_CATEGORY,
      });

      if (!torrents || torrents.length === 0) {
        logger.debug(`[DescImageCache] No results for "${query}" page ${page}`);
        return;
      }

      logger.debug(`[DescImageCache] "${query}" page ${page}: ${torrents.length} torrents`);
      results.totalTorrents += torrents.length;

      for (const torrent of torrents) {
        await this.processTorrent(torrent, results);
        await this.sleep(300); // gentle rate limit between detail fetches
      }

      await this.sleep(500); // extra pause between pages
    } catch (err) {
      results.failed++;
      this.pushError(results, { query, page, error: err.message });
      logger.warn(`⚠️ [DescImageCache] Search failed for "${query}" page ${page}`, { error: err.message });
    }
  }

  /**
   * Fetch details for a single torrent and cache its cover image
   */
  async processTorrent(torrent, results) {
    try {
      // Skip if image already cached
      const existing = await this.storage.images.getCoverImage(torrent);
      if (existing) {
        results.skipped++;
        return;
      }

      if (!torrent.Url) {
        results.skipped++;
        return;
      }

      // Fetch description + images from piratebay detail page
      const details = await pirateBay.getDetails(torrent.Url);

      if (!details.images || details.images.length === 0) {
        results.skipped++;
        return;
      }

      results.imagesFound++;

      // Walk the images array and pick the first URL not already used by another
      // torrent this run. Shared uploader banners/logos appear as images[0] across
      // many results, so we skip any URL we've seen before to give each torrent a
      // unique cover image.
      let imageUrl = null;
      for (const img of details.images) {
        const url = img.directUrl || img.originalUrl;
        if (url && !results.usedImageUrls.has(url)) {
          imageUrl = url;
          break;
        }
      }

      if (!imageUrl) {
        results.skipped++;
        return;
      }

      results.usedImageUrls.add(imageUrl);
      const success = await this.storage.images.setCoverImage(torrent, imageUrl);
      if (success) {
        results.cached++;
        logger.debug(`✅ [DescImageCache] Cached image for: ${torrent.Name}`);
      } else {
        results.failed++;
        this.pushError(results, { torrent: torrent.Name, error: 'setCoverImage returned false' });
      }
    } catch (err) {
      results.failed++;
      this.pushError(results, { torrent: torrent.Name, error: err.message });
    }
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

module.exports = DescriptionImageCacheService;
