/**
 * Torrent Scraper Service
 *
 * This service consolidates all torrent scraping functionality from multiple sources.
 * Each scraper is responsible for fetching and parsing torrent data from a specific website.
 */

// Import individual scraper modules
const limeTorrent = require('./scrapers/limeTorrent');
const nyaaSI = require('./scrapers/nyaaSI');
const pirateBay = require('./scrapers/pirateBay');
const torrentProject = require('./scrapers/torrentProject');
const yts = require('./scrapers/yts');
const x1337 = require('./scrapers/1337x');

/**
 * Available torrent scrapers mapped by website identifier
 */
const scrapers = {
  limetorrent: limeTorrent,
  nyaasi: nyaaSI,
  piratebay: pirateBay,
  torrentproject: torrentProject,
  yts: yts,
  '1337x': x1337,
};

/**
 * Get list of available scraper names
 * @returns {string[]} Array of scraper identifiers
 */
function getAvailableScrapers() {
  return Object.keys(scrapers);
}

/**
 * Get a specific scraper by name
 * @param {string} scraperName - Name of the scraper (e.g., 'piratebay')
 * @returns {Function|null} The scraper function or null if not found
 */
function getScraper(scraperName) {
  return scrapers[scraperName.toLowerCase()] || null;
}

/**
 * Search a specific torrent website
 * @param {string} scraperName - Name of the scraper to use
 * @param {string} query - Search query
 * @param {number|string} page - Page number
 * @param {Object} options - Search options (minSeeders, maxResults, etc.)
 * @returns {Promise<Array>} Array of torrent results
 */
async function searchTorrents(scraperName, query, page = 1, options = {}) {
  const scraper = getScraper(scraperName);

  if (!scraper) {
    throw new Error(`Scraper "${scraperName}" not found. Available scrapers: ${getAvailableScrapers().join(', ')}`);
  }

  try {
    const results = await scraper(query, page, options);
    return results || [];
  } catch (error) {
    console.error(`Error scraping ${scraperName}:`, error.message);
    throw error;
  }
}

/**
 * Search all available torrent websites in parallel
 * @param {string} query - Search query
 * @param {number|string} page - Page number
 * @param {Object} options - Search options (minSeeders, maxResults, includeCoverImages, etc.)
 * @returns {Promise<Array>} Combined array of torrent results from all sources
 */
async function searchAllTorrents(query, page = 1, options = {}) {
  const PROVIDER_TIMEOUT = 6000; // 6 seconds per provider
  const searchPromises = [];

  // Create search promises for each scraper with timeout
  for (const scraperName in scrapers) {
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve([]), PROVIDER_TIMEOUT);
    });

    const scraperPromise = scrapers[scraperName](query, page, options).catch(() => {
      return []; // Return empty array on error
    });

    searchPromises.push(Promise.race([scraperPromise, timeoutPromise]));
  }

  // Use allSettled to get partial results even if some fail
  const results = await Promise.allSettled(searchPromises);

  // Combine all successful results
  let combinedTorrents = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
      combinedTorrents.push(...result.value);
    }
  }

  // Apply filtering
  if (options.minSeeders) {
    combinedTorrents = combinedTorrents.filter((torrent) => {
      const seeders = parseInt(torrent.Seeders) || 0;
      return seeders >= options.minSeeders;
    });
  }

  // Apply maxResults limit
  if (options.maxResults && combinedTorrents.length > options.maxResults) {
    combinedTorrents = combinedTorrents.slice(0, options.maxResults);
  }

  return combinedTorrents;
}

/**
 * Get detailed information about a specific torrent
 * @param {string} scraperName - Name of the scraper to use
 * @param {string} torrentUrl - URL of the torrent details page
 * @returns {Promise<Object>} Torrent details including description, files, etc.
 */
async function getTorrentDetails(scraperName, torrentUrl) {
  const scraper = getScraper(scraperName);

  if (!scraper) {
    throw new Error(`Scraper "${scraperName}" not found`);
  }

  if (!scraper.getDetails) {
    throw new Error(`Scraper "${scraperName}" does not support detailed information`);
  }

  try {
    const details = await scraper.getDetails(torrentUrl);
    return details;
  } catch (error) {
    console.error(`Error getting torrent details from ${scraperName}:`, error.message);
    throw error;
  }
}

module.exports = {
  // Scraper registry
  scrapers,

  // Query functions
  getAvailableScrapers,
  getScraper,
  searchTorrents,
  searchAllTorrents,
  getTorrentDetails,
};
