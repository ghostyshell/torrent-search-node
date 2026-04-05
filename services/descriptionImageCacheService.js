const pirateBay = require('./scrapers/pirateBay');
const pixhostService = require('./pixhostService');
const logger = require('../middleware/logger');
const fetch = require('node-fetch');
const { STUDIOS } = require('./studioSearchTerms');

const PIRATEBAY_CATEGORY = '507'; // Porn HD
const PIRATEBAY_SORT = '7';       // Seeders desc (search)
const BROWSE_SORT = '3';          // Date desc — /browse/507/{page}/3 (UI homepage)
const PAGES_BROWSE_HOME = 6;
const HOME_QUERY = 'xxx';
const PAGES_TO_CACHE = 5;
const MAX_ERRORS = 30;

class DescriptionImageCacheService {
  constructor(storageProvider) {
    this.storage = storageProvider;
  }

  /**
   * Main cache job: browse homepage (6 pages) + "xxx" search + all studio pages
   * @param {Object} options
   * @param {boolean} options.forceRefresh - If true, replace existing covers
   */
  async runCacheJob(options = {}) {
    this.forceRefresh = options.forceRefresh || false;
    const startTime = Date.now();
    const results = {
      totalSearches: 0,
      totalTorrents: 0,
      imagesFound: 0,
      cached: 0,
      replaced: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    logger.info(`🖼️ [DescImageCache] Starting description/image cache job${this.forceRefresh ? ' (FORCE REFRESH)' : ''}`);

    // 1. Browse homepage — same listing as UI when no search (thehiddenbay.com/browse/507/{page}/3)
    logger.info(
      `🔍 [DescImageCache] Processing browse homepage category ${PIRATEBAY_CATEGORY} sort ${BROWSE_SORT} (${PAGES_BROWSE_HOME} pages)`
    );
    for (let page = 1; page <= PAGES_BROWSE_HOME; page++) {
      await this.processBrowsePage(page, results);
    }

    // 2. Home page "xxx" query — pages 1-5
    logger.info(`🔍 [DescImageCache] Processing home query "${HOME_QUERY}" (${PAGES_TO_CACHE} pages)`);
    for (let page = 1; page <= PAGES_TO_CACHE; page++) {
      await this.processSearchPage(HOME_QUERY, page, results);
    }

    // 3. Each studio — pages 1-5 (Porn HD / 507, same as home query)
    for (const studio of STUDIOS) {
      logger.info(`🎬 [DescImageCache] Processing studio "${studio}" (${PAGES_TO_CACHE} pages)`);
      for (let page = 1; page <= PAGES_TO_CACHE; page++) {
        await this.processSearchPage(studio, page, results);
      }
      pixhostService.clearCache();
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('✅ [DescImageCache] Job completed', {
      duration: `${duration}s`,
      totalSearches: results.totalSearches,
      totalTorrents: results.totalTorrents,
      imagesFound: results.imagesFound,
      cached: results.cached,
      replaced: results.replaced,
      skipped: results.skipped,
      failed: results.failed,
    });

    return results;
  }

  /**
   * Fetch one browse page (homepage listing) and process each torrent
   */
  async processBrowsePage(page, results) {
    results.totalSearches++;
    try {
      const torrents = await pirateBay.browse(
        PIRATEBAY_CATEGORY,
        String(page),
        BROWSE_SORT,
        {}
      );

      if (!torrents || torrents.length === 0) {
        logger.info(`[DescImageCache] No browse results page ${page}`);
        return;
      }

      logger.info(
        `[DescImageCache] browse/${PIRATEBAY_CATEGORY}/${page}/${BROWSE_SORT}: ${torrents.length} torrents`
      );
      results.totalTorrents += torrents.length;

      for (const torrent of torrents) {
        await this.processTorrent(torrent, results);
        await this.sleep(1000);
      }

      await this.sleep(500);
    } catch (err) {
      results.failed++;
      this.pushError(results, { browse: true, page, error: err.message });
      logger.warn(`⚠️ [DescImageCache] Browse failed page ${page}`, { error: err.message });
    }
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
        logger.info(`[DescImageCache] No results for "${query}" page ${page}`);
        return;
      }

      logger.info(`[DescImageCache] "${query}" page ${page}: ${torrents.length} torrents`);
      results.totalTorrents += torrents.length;

      for (const torrent of torrents) {
        await this.processTorrent(torrent, results);
        await this.sleep(1000);
      }

      await this.sleep(500);
    } catch (err) {
      results.failed++;
      this.pushError(results, { query, page, error: err.message });
      logger.warn(`⚠️ [DescImageCache] Search failed for "${query}" page ${page}`, { error: err.message });
    }
  }

  /**
   * Process a single torrent — mirrors the frontend's
   * descriptionImageService.processTorrentDescriptionAndImages() flow:
   *   1. Fetch details via pirateBay.getDetails(url)
   *   2. From the returned images, randomly pick one of the first 3
   *   3. Enhance the URL (remove .md thumbnails, etc.) — same logic as frontend
   *   4. Validate the enhanced URL with a HEAD request (5s timeout)
   *   5. Upload to Pixhost
   *   6. Store via storage.images.setCoverImage()
   *
   * Always force-refreshes: overwrites existing cover images so broken/default
   * images get replaced.
   */
  async processTorrent(torrent, results) {
    try {
      if (!torrent.Url) {
        results.skipped++;
        return;
      }

      // Skip if torrent already has a cover image (unless force refreshing)
      if (!this.forceRefresh) {
        const existing = await this.storage.images.getCoverImage(torrent);
        if (existing) {
          results.skipped++;
          return;
        }
      }

      // Fetch description + images from piratebay detail page
      const details = await pirateBay.getDetails(torrent.Url);

      if (!details.images || details.images.length === 0) {
        results.skipped++;
        return;
      }

      results.imagesFound++;

      // Take first 3 images, randomly pick one
      const firstThree = details.images.slice(0, 3);
      const randomIndex = Math.floor(Math.random() * firstThree.length);
      const selectedImage = firstThree[randomIndex];

      const rawUrl = selectedImage.directUrl || selectedImage.originalUrl;
      if (!rawUrl) {
        results.skipped++;
        return;
      }

      // Enhance resolution
      let finalImageUrl = this.getHigherResolutionUrl(rawUrl);

      // Validate enhanced URL with HEAD request (5s timeout)
      if (finalImageUrl !== rawUrl) {
        const valid = await this.validateUrl(finalImageUrl);
        if (!valid) {
          finalImageUrl = rawUrl.replace(/\.md(\.[^.]+)$/, '$1');
        }
      } else {
        finalImageUrl = rawUrl.replace(/\.md(\.[^.]+)$/, '$1');
      }

      // Upload to Pixhost
      let pixhostUrl = null;
      try {
        const uploadResult = await pixhostService.uploadFromUrl(finalImageUrl);
        pixhostUrl = uploadResult.directImageUrl;
      } catch (uploadErr) {
        logger.info(`[DescImageCache] Pixhost upload failed for "${torrent.Name}": ${uploadErr.message}`);
      }

      const urlToStore = pixhostUrl || finalImageUrl;

      // Store via setCoverImage
      const success = await this.storage.images.setCoverImage(torrent, urlToStore);
      if (success) {
        results.cached++;
        logger.info(`✅ [DescImageCache] Cached cover for: ${torrent.Name}`);
      } else {
        results.failed++;
        this.pushError(results, { torrent: torrent.Name, error: 'setCoverImage returned false' });
      }
    } catch (err) {
      results.failed++;
      this.pushError(results, { torrent: torrent.Name, error: err.message });
      logger.warn(`❌ [DescImageCache] Error processing "${torrent.Name}": ${err.message}`);
    }
  }

  /**
   * Try to get higher resolution version of an image URL.
   * Mirrors frontend descriptionImageService.getHigherResolutionUrl()
   */
  getHigherResolutionUrl(directUrl) {
    try {
      if (directUrl.includes('trafficimage.club')) {
        return directUrl.replace(/\.md(\.[^.]+)$/, '$1');
      }
      if (directUrl.includes('postimg.cc')) {
        return directUrl
          .replace(/\/[st]\d+x\d+\//, '/')
          .replace(/_thumb\./, '.')
          .replace(/\?[^=]*thumb[^=]*=[^&]*(&|$)/, '');
      }
      if (directUrl.includes('ibb.co')) {
        return directUrl.replace(/\/[st]\d+x\d+\//, '/');
      }
      if (directUrl.includes('imgur.com')) {
        return directUrl
          .replace(/[sbtlmh]\.jpg$/, '.jpg')
          .replace(/\.jpg$/, 'h.jpg');
      }
      if (directUrl.includes('fastpic.org')) {
        return directUrl.replace(/\/thumbs\//, '/big/');
      }
      // Generic: remove common thumbnail suffixes
      return directUrl
        .replace(/\.md(\.[^.]+)$/, '$1')
        .replace(/_thumb(\.[^.]+)$/, '$1')
        .replace(/_small(\.[^.]+)$/, '$1')
        .replace(/_medium(\.[^.]+)$/, '$1')
        .replace(/\.thumb(\.[^.]+)$/, '$1');
    } catch {
      return directUrl;
    }
  }

  /**
   * Validate a URL with a HEAD request (5s timeout).
   * Mirrors frontend's enhanced URL validation.
   */
  async validateUrl(url) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
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
