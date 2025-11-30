/**
 * 1337x Torrent Scraper
 *
 * This scraper uses FlareSolverr to bypass Cloudflare protection on 1337x.to
 * FlareSolverr is a proxy server that uses Selenium to solve Cloudflare challenges
 *
 * Important notes about FlareSolverr:
 * - Web browsers consume a lot of memory, avoid making many parallel requests
 * - Sessions can be used for multiple requests but must be closed when done
 * - Default timeout is usually sufficient but can be increased for slow connections
 */

const cheerio = require('cheerio');
const axios = require('axios');
const { extractImageLinks } = require('../imageExtractorService');

// FlareSolverr configuration
// Hosted FlareSolverr instance: https://flaresolver.sliplane.app/
const FLARESOLVERR_URL =
  process.env.FLARESOLVERR_URL || 'https://flaresolver.sliplane.app/v1';
const FLARESOLVERR_MAX_TIMEOUT = 80000; // 80 seconds - 1337x.to needs longer timeout for Cloudflare

// 1337x base URL - using original domain as mirrors have incomplete search results
const BASE_URL = 'https://1337x.to';

// Logging helper
const log = {
  info: (msg, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[1337x][${timestamp}] INFO: ${msg}`,
      data ? JSON.stringify(data, null, 2) : ''
    );
  },
  warn: (msg, data = null) => {
    const timestamp = new Date().toISOString();
    console.warn(
      `[1337x][${timestamp}] WARN: ${msg}`,
      data ? JSON.stringify(data, null, 2) : ''
    );
  },
  error: (msg, error = null) => {
    const timestamp = new Date().toISOString();
    console.error(
      `[1337x][${timestamp}] ERROR: ${msg}`,
      error
        ? {
            message: error.message,
            stack: error.stack,
            response: error.response?.data,
            status: error.response?.status,
          }
        : ''
    );
  },
  debug: (msg, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[1337x][${timestamp}] DEBUG: ${msg}`,
      data ? JSON.stringify(data, null, 2) : ''
    );
  },
};

/**
 * Make a request through FlareSolverr to bypass Cloudflare
 * @param {string} url - The URL to request
 * @param {string} sessionId - Optional session ID for persistent sessions
 * @returns {Promise<{html: string, cookies: Array}>} The HTML content and cookies
 */
async function flareSolverrRequest(url, sessionId = null) {
  const startTime = Date.now();
  log.info(`FlareSolverr request starting`, {
    url,
    flaresolverr: FLARESOLVERR_URL,
    timeout: FLARESOLVERR_MAX_TIMEOUT,
  });

  const payload = {
    cmd: 'request.get',
    url: url,
    maxTimeout: FLARESOLVERR_MAX_TIMEOUT,
  };

  // Use session if provided (for multiple requests to same domain)
  if (sessionId) {
    payload.session = sessionId;
  }

  try {
    const response = await axios.post(FLARESOLVERR_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: FLARESOLVERR_MAX_TIMEOUT + 10000, // Add buffer for FlareSolverr processing
    });

    const duration = Date.now() - startTime;

    if (response.data.status === 'ok') {
      const htmlLength = response.data.solution?.response?.length || 0;
      log.info(`FlareSolverr request successful`, {
        duration: `${duration}ms`,
        htmlLength,
        challengeDetected:
          response.data.message?.includes('Challenge') || false,
      });
      return {
        html: response.data.solution.response,
        cookies: response.data.solution.cookies,
        userAgent: response.data.solution.userAgent,
      };
    } else {
      log.error(`FlareSolverr returned error status`, {
        status: response.data.status,
        message: response.data.message,
        duration: `${duration}ms`,
      });
      throw new Error(`FlareSolverr error: ${response.data.message}`);
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error(`FlareSolverr request failed after ${duration}ms`, error);

    if (error.response) {
      throw new Error(
        `FlareSolverr request failed: ${
          error.response.data?.message || error.message
        }`
      );
    }
    throw error;
  }
}

/**
 * Create a FlareSolverr session for multiple requests
 * @returns {Promise<string>} Session ID
 */
async function createSession() {
  try {
    const response = await axios.post(
      FLARESOLVERR_URL,
      {
        cmd: 'sessions.create',
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.status === 'ok') {
      return response.data.session;
    }
    throw new Error('Failed to create FlareSolverr session');
  } catch (error) {
    console.error('Error creating FlareSolverr session:', error.message);
    return null;
  }
}

/**
 * Destroy a FlareSolverr session
 * @param {string} sessionId - The session ID to destroy
 */
async function destroySession(sessionId) {
  if (!sessionId) return;

  try {
    await axios.post(
      FLARESOLVERR_URL,
      {
        cmd: 'sessions.destroy',
        session: sessionId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error destroying FlareSolverr session:', error.message);
  }
}

/**
 * Parse size string from 1337x format
 * @param {string} sizeStr - Size string like "1.5 GB"
 * @returns {string} Normalized size string
 */
function parseSize(sizeStr) {
  return sizeStr ? sizeStr.trim() : '';
}

/**
 * Search for torrents on 1337x
 * @param {string} query - Search query
 * @param {string|number} page - Page number (1-based)
 * @param {Object} options - Search options
 * @param {number} options.minSeeders - Minimum number of seeders
 * @param {number} options.maxResults - Maximum number of results to return
 * @param {string} options.category - Category filter (Movies, TV, Games, Music, Apps, Anime, Documentaries, XXX, Other)
 * @param {string} options.sort - Sort by (time, size, seeders, leechers) - default: time
 * @param {string} options.order - Order (desc, asc) - default: desc
 * @returns {Promise<Array>} Array of torrent results
 */
async function search1337x(query, page = '1', options = {}) {
  const searchStartTime = Date.now();
  log.info(`Starting 1337x search`, { query, page, options });

  const allTorrents = [];
  const pageNum = parseInt(page) || 1;

  // Build search URL based on options
  let url;
  const encodedQuery = encodeURIComponent(query);
  const category = options.category ? options.category.toLowerCase() : null;
  const sort = options.sort || 'time';
  const order = options.order || 'desc';

  if (category) {
    // Category search with sorting
    url = `${BASE_URL}/sort-category-search/${encodedQuery}/${category}/${sort}/${order}/${pageNum}/`;
  } else if (options.sort) {
    // Sorted search
    url = `${BASE_URL}/sort-search/${encodedQuery}/${sort}/${order}/${pageNum}/`;
  } else {
    // Basic search
    url = `${BASE_URL}/search/${encodedQuery}/${pageNum}/`;
  }

  log.info(`Built search URL`, { url });

  let sessionId = null;

  try {
    // Use FlareSolverr to get the page content
    const { html } = await flareSolverrRequest(url, sessionId);

    log.debug(`Received HTML response`, { htmlLength: html?.length || 0 });

    const $ = cheerio.load(html);

    // Check if we got a valid page
    const pageTitle = $('title').text();
    const tableExists = $('table.table-list').length > 0;
    const rowCount = $('table.table-list tbody tr').length;

    log.info(`Page parsing info`, { pageTitle, tableExists, rowCount });

    // Parse search results from the table
    $('table.table-list tbody tr').each((_, element) => {
      const $row = $(element);

      // Extract torrent name and URL from the second column
      const $nameCell = $row.find('td.coll-1.name');
      const $nameLink = $nameCell.find('a').eq(1); // Second link contains the name
      const name = $nameLink.text().trim();
      const torrentPath = $nameLink.attr('href');

      if (!name || !torrentPath) return;

      // Extract seeders (third column)
      const seedersText = $row.find('td.coll-2.seeds').text().trim();
      const seeders = parseInt(seedersText) || 0;

      // Extract leechers (fourth column)
      const leechersText = $row.find('td.coll-3.leeches').text().trim();
      const leechers = parseInt(leechersText) || 0;

      // Extract date (fifth column)
      const dateUploaded = $row.find('td.coll-date').text().trim();

      // Extract size (sixth column - has both size and uploader info)
      const $sizeCell = $row.find('td.coll-4.size');
      // The size text is the direct text content, excluding the nested span
      const sizeText = $sizeCell
        .clone()
        .children()
        .remove()
        .end()
        .text()
        .trim();

      // Extract category from the first column icon/link
      const category = $row.find('td.coll-1.name a').first().text().trim();

      // Apply minimum seeders filter early
      if (options.minSeeders && seeders < options.minSeeders) {
        return; // Skip this torrent
      }

      const torrent = {
        Name: name,
        Size: parseSize(sizeText),
        DateUploaded: dateUploaded,
        Category: category,
        Seeders: seedersText,
        Leechers: leechersText,
        Url: `${BASE_URL}${torrentPath}`,
        Source: '1337x',
      };

      allTorrents.push(torrent);
    });

    const searchDuration = Date.now() - searchStartTime;
    log.info(`Search completed successfully`, {
      resultsCount: allTorrents.length,
      duration: `${searchDuration}ms`,
      query,
      page,
    });
  } catch (error) {
    const searchDuration = Date.now() - searchStartTime;
    log.error(`Error scraping 1337x after ${searchDuration}ms`, error);
    return null;
  } finally {
    // Clean up session if we created one
    if (sessionId) {
      await destroySession(sessionId);
    }
  }

  // Apply maxResults filter if specified
  if (options.maxResults && allTorrents.length > options.maxResults) {
    return allTorrents.slice(0, options.maxResults);
  }

  return allTorrents;
}

/**
 * Get detailed information about a specific torrent from 1337x
 * @param {string} torrentUrl - URL of the torrent details page
 * @returns {Promise<Object>} Torrent details including description, files, magnet, etc.
 */
async function get1337xDetails(torrentUrl) {
  const startTime = Date.now();
  log.info(`Getting torrent details`, { torrentUrl });

  let sessionId = null;

  try {
    // Ensure the URL is complete
    const fullUrl = torrentUrl.startsWith('http')
      ? torrentUrl
      : `${BASE_URL}${torrentUrl}`;

    log.debug(`Fetching details from`, { fullUrl });

    // Use FlareSolverr to get the page content
    const { html } = await flareSolverrRequest(fullUrl, sessionId);
    const $ = cheerio.load(html);

    // Extract magnet link
    const magnetLink = $('a[href^="magnet:"]').attr('href') || '';

    // Extract torrent hash from the magnet link or page
    let hash = '';
    const hashMatch = magnetLink.match(/btih:([a-fA-F0-9]+)/);
    if (hashMatch) {
      hash = hashMatch[1].toUpperCase();
    }

    log.debug(`Extracted magnet info`, { hasMagnet: !!magnetLink, hash });

    // Extract description from the description box
    const description =
      $('#description').text().trim() ||
      $('.torrent-detail-info .box-info-detail').text().trim() ||
      'No description available';

    // Extract image links from description
    const imageLinks = await extractImageLinks(description);

    // Also look for images in the description HTML
    const descriptionHtml = $('#description').html() || '';
    const imgMatches =
      descriptionHtml.match(
        /https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp)/gi
      ) || [];

    // Combine and deduplicate images
    const allImages = [...new Set([...imageLinks, ...imgMatches])];

    // Extract detailed info from the info box
    const details = {
      description: description,
      magnet: magnetLink,
      hash: hash,
      files: [],
      comments: [],
      images: allImages,
    };

    // Extract additional metadata from the info box
    $('.torrent-detail-page .box-info ul.list li').each((_, element) => {
      const label = $(element).find('strong').text().trim().replace(':', '');
      const value = $(element).find('span').text().trim();

      switch (label.toLowerCase()) {
        case 'category':
          details.category = value;
          break;
        case 'type':
          details.type = value;
          break;
        case 'language':
          details.language = value;
          break;
        case 'total size':
          details.totalSize = value;
          break;
        case 'downloads':
          details.downloads = value;
          break;
        case 'date uploaded':
          details.dateUploaded = value;
          break;
        case 'uploaded by':
          details.uploadedBy = value;
          break;
      }
    });

    // Extract file list
    $('.torrent-file-list ul li').each((_, element) => {
      const fileName = $(element).text().trim();
      if (fileName) {
        // Try to separate filename from size if present
        const parts = fileName.split(/\s+\(([^)]+)\)$/);
        details.files.push({
          name: parts[0].trim(),
          size: parts[1] || '',
        });
      }
    });

    // Alternative file list structure
    if (details.files.length === 0) {
      $('#files .file-list li, .filelist li').each((_, element) => {
        const fileName =
          $(element).find('.filename, .file-name').text().trim() ||
          $(element).clone().children().remove().end().text().trim();
        const fileSize = $(element).find('.size, .file-size').text().trim();

        if (fileName) {
          details.files.push({
            name: fileName,
            size: fileSize,
          });
        }
      });
    }

    const duration = Date.now() - startTime;
    log.info(`Details fetched successfully`, {
      duration: `${duration}ms`,
      hasMagnet: !!magnetLink,
      filesCount: details.files.length,
      imagesCount: allImages.length,
    });

    return details;
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error(`Error getting 1337x torrent details after ${duration}ms`, error);
    return {
      description: 'Failed to load description',
      magnet: '',
      hash: '',
      files: [],
      comments: [],
      images: [],
      error: error.message,
    };
  } finally {
    if (sessionId) {
      await destroySession(sessionId);
    }
  }
}

/**
 * Diagnostic function to test FlareSolverr connectivity and 1337x access
 * @returns {Promise<Object>} Diagnostic results
 */
async function diagnose1337x() {
  const results = {
    timestamp: new Date().toISOString(),
    flaresolverrUrl: FLARESOLVERR_URL,
    baseUrl: BASE_URL,
    timeout: FLARESOLVERR_MAX_TIMEOUT,
    tests: {},
  };

  // Test 1: Check FlareSolverr is reachable
  try {
    log.info('Running diagnostic: FlareSolverr connectivity test');
    const startTime = Date.now();
    const response = await axios.post(
      FLARESOLVERR_URL,
      {
        cmd: 'request.get',
        url: 'https://www.google.com',
        maxTimeout: 30000,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 35000,
      }
    );

    results.tests.flaresolverrConnectivity = {
      success: response.data.status === 'ok',
      duration: Date.now() - startTime,
      status: response.data.status,
      message: response.data.message,
    };
  } catch (error) {
    results.tests.flaresolverrConnectivity = {
      success: false,
      error: error.message,
      code: error.code,
      responseStatus: error.response?.status,
    };
  }

  // Test 2: Check 1337x access via FlareSolverr
  try {
    log.info('Running diagnostic: 1337x access test');
    const startTime = Date.now();
    const response = await axios.post(
      FLARESOLVERR_URL,
      {
        cmd: 'request.get',
        url: `${BASE_URL}/home/`,
        maxTimeout: FLARESOLVERR_MAX_TIMEOUT,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: FLARESOLVERR_MAX_TIMEOUT + 10000,
      }
    );

    const hasValidContent =
      response.data.solution?.response?.includes('1337x') ||
      response.data.solution?.response?.includes('torrent');

    results.tests.x1337Access = {
      success: response.data.status === 'ok' && hasValidContent,
      duration: Date.now() - startTime,
      status: response.data.status,
      message: response.data.message,
      htmlLength: response.data.solution?.response?.length || 0,
      hasValidContent,
    };
  } catch (error) {
    results.tests.x1337Access = {
      success: false,
      error: error.message,
      code: error.code,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    };
  }

  // Test 3: Test a simple search
  try {
    log.info('Running diagnostic: Simple search test');
    const startTime = Date.now();
    const searchResults = await search1337x('test', '1', { maxResults: 5 });

    results.tests.simpleSearch = {
      success: Array.isArray(searchResults) && searchResults.length > 0,
      duration: Date.now() - startTime,
      resultsCount: searchResults?.length || 0,
      sampleResult: searchResults?.[0]
        ? {
            name: searchResults[0].Name?.substring(0, 50),
            hasUrl: !!searchResults[0].Url,
          }
        : null,
    };
  } catch (error) {
    results.tests.simpleSearch = {
      success: false,
      error: error.message,
    };
  }

  log.info('Diagnostic complete', results);
  return results;
}

// Attach the getDetails function to the main function
search1337x.getDetails = get1337xDetails;

// Export session management functions for advanced usage
search1337x.createSession = createSession;
search1337x.destroySession = destroySession;
search1337x.flareSolverrRequest = flareSolverrRequest;
search1337x.diagnose = diagnose1337x;
search1337x.log = log;

module.exports = search1337x;
