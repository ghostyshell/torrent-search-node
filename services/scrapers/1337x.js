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
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'https://flaresolver.sliplane.app/v1';
const FLARESOLVERR_MAX_TIMEOUT = 60000; // 60 seconds

// 1337x base URL - using 1337xx.to mirror as main domain has aggressive Cloudflare protection
const BASE_URL = 'https://www.1337xx.to';

/**
 * Make a request through FlareSolverr to bypass Cloudflare
 * @param {string} url - The URL to request
 * @param {string} sessionId - Optional session ID for persistent sessions
 * @returns {Promise<{html: string, cookies: Array}>} The HTML content and cookies
 */
async function flareSolverrRequest(url, sessionId = null) {
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

    if (response.data.status === 'ok') {
      return {
        html: response.data.solution.response,
        cookies: response.data.solution.cookies,
        userAgent: response.data.solution.userAgent,
      };
    } else {
      throw new Error(`FlareSolverr error: ${response.data.message}`);
    }
  } catch (error) {
    if (error.response) {
      throw new Error(`FlareSolverr request failed: ${error.response.data?.message || error.message}`);
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
    const response = await axios.post(FLARESOLVERR_URL, {
      cmd: 'sessions.create',
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

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
    await axios.post(FLARESOLVERR_URL, {
      cmd: 'sessions.destroy',
      session: sessionId,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
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

  let sessionId = null;

  try {
    // Use FlareSolverr to get the page content
    const { html } = await flareSolverrRequest(url, sessionId);
    const $ = cheerio.load(html);

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
      const sizeText = $sizeCell.clone().children().remove().end().text().trim();

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

  } catch (error) {
    console.error('Error scraping 1337x:', error.message);
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
  let sessionId = null;

  try {
    // Ensure the URL is complete
    const fullUrl = torrentUrl.startsWith('http')
      ? torrentUrl
      : `${BASE_URL}${torrentUrl}`;

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

    // Extract description from the description box
    const description = $('#description').text().trim() ||
      $('.torrent-detail-info .box-info-detail').text().trim() ||
      'No description available';

    // Extract image links from description
    const imageLinks = await extractImageLinks(description);

    // Also look for images in the description HTML
    const descriptionHtml = $('#description').html() || '';
    const imgMatches = descriptionHtml.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp)/gi) || [];

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
        const fileName = $(element).find('.filename, .file-name').text().trim() ||
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

    return details;
  } catch (error) {
    console.error('Error getting 1337x torrent details:', error.message);
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

// Attach the getDetails function to the main function
search1337x.getDetails = get1337xDetails;

// Export session management functions for advanced usage
search1337x.createSession = createSession;
search1337x.destroySession = destroySession;
search1337x.flareSolverrRequest = flareSolverrRequest;

module.exports = search1337x;

