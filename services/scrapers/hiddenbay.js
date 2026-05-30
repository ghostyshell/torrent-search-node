/**
 * hiddenbay.js
 * Scraper for TheHiddenBay (thehiddenbay.com) — a TPB-compatible mirror
 * used as the primary adult content source.
 *
 * Endpoints:
 *   Search:  /s/?q={query}&category={cat}&page={page}&orderby=99
 *   Browse:  /browse/{category}/{page}/{sort}
 *   Details: /torrent/{id}/{slug}
 *
 * HiddenBay adult category numbers:
 *   500 – All Porn          505 – HD-Movies
 *   501 – Movies            507 – UHD/4K-Movies
 *   502 – Movies DVDR       506 – Movie Clips
 */

'use strict';

const cheerio = require('cheerio');
const axios   = require('axios');
const { extractImageLinks } = require('../imageExtractorService');

const BASE_URL = (process.env.HIDDENBAY_URL || 'https://thehiddenbay.com').replace(/\/$/, '');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Search HiddenBay.
 *
 * @param {string}  query
 * @param {string|number} page
 * @param {object}  options
 *   @param {string}  options.category    – HiddenBay category number (default "500")
 *   @param {number}  options.minSeeders
 *   @param {number}  options.maxResults
 * @returns {Promise<object[]|null>}
 */
async function hiddenBay(query, page = '1', options = {}) {
  const category = options.category || '500'; // All Porn
  const url = `${BASE_URL}/s/?q=${encodeURIComponent(query)}&category=${category}&page=${page}&orderby=99`;

  let html;
  try {
    html = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  } catch {
    return null;
  }

  return parseTorrentList(cheerio.load(html.data), options);
}

// ── Browse ────────────────────────────────────────────────────────────────────

/**
 * Browse a HiddenBay category without a search query.
 *
 * @param {string}        category – HiddenBay category number (default "500")
 * @param {string|number} page
 * @param {string}        sort     – sort code (3 = seeders desc)
 * @param {object}        options
 * @returns {Promise<object[]|null>}
 */
async function hiddenBayBrowse(category = '500', page = '1', sort = '3', options = {}) {
  const url = `${BASE_URL}/browse/${category}/${page}/${sort}`;

  let html;
  try {
    html = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  } catch {
    return null;
  }

  return parseTorrentList(cheerio.load(html.data), options);
}

// ── Details ───────────────────────────────────────────────────────────────────

/**
 * Fetch torrent details from a HiddenBay detail page.
 * Extracts description from the NFO pre block and resolves embedded image URLs.
 *
 * @param {string} torrentUrl – absolute or relative URL to the detail page
 * @returns {Promise<object>}
 */
async function hiddenBayDetails(torrentUrl) {
  try {
    const fullUrl = torrentUrl.startsWith('http')
      ? torrentUrl
      : `${BASE_URL}${torrentUrl}`;

    const html = await axios.get(fullUrl, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(html.data);

    // NFO text is the primary source of both the description and image URLs
    const description =
      $('#details .nfo pre').text().trim() ||
      $('.nfo pre').text().trim()          ||
      $('#description').text().trim()      ||
      $('.description').text().trim()      ||
      'No description available';

    // Resolve image-hosting URLs found in the NFO plain text
    const imageLinks = await extractImageLinks(description);

    const details = {
      description,
      files:    [],
      comments: [],
      images:   imageLinks,
    };

    // File list (if present on the detail page)
    $('table.torrentFileList tr').each((_, element) => {
      const fileName = $(element).find('td').first().text().trim();
      const fileSize = $(element).find('td').eq(1).text().trim();
      if (fileName && fileName !== 'File Name' && fileName !== '') {
        details.files.push({ name: fileName, size: fileSize });
      }
    });

    return details;
  } catch (error) {
    return {
      description: 'Failed to load description',
      files:       [],
      comments:    [],
      images:      [],
      error:       error.message,
    };
  }
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse a TPB-style #searchResult table into an array of torrent objects.
 */
function parseTorrentList($, options = {}) {
  const allTorrents = [];

  $('table#searchResult tr').each((_, element) => {
    // Metadata line: "date, size, uploader"
    const data = $(element)
      .find('font.detDesc')
      .text()
      .replace(/(Size|Uploaded)/gi, '')
      .replace(/ULed/gi, 'Uploaded')
      .split(',')
      .map((v) => v.trim());

    const date     = data[0] || '';
    const size     = data[1] || '';
    const uploader = $(element).find('font.detDesc a').text();

    const seedersText  = $(element).find('td').eq(2).text();
    const leechersText = $(element).find('td').eq(3).text();
    const seeders      = parseInt(seedersText)  || 0;

    const nameLink = $(element).find('a.detLink');
    const name     = nameLink.text().trim();
    if (!name) return;

    let torrentUrl = nameLink.attr('href') || '';
    if (torrentUrl && !torrentUrl.startsWith('http')) {
      torrentUrl = BASE_URL + torrentUrl;
    }

    // Magnet link is the sibling <a> immediately after the detName div
    const magnet = $(element).find('td div.detName').next().attr('href') || '';

    const torrent = {
      Name:         name,
      Size:         size,
      DateUploaded: date,
      Category:     $(element).find('td.vertTh center a').eq(0).text(),
      Seeders:      seedersText,
      Leechers:     leechersText,
      UploadedBy:   uploader,
      Url:          torrentUrl,
      Magnet:       magnet,
      Source:       'hiddenbay',
    };

    if (options.minSeeders && seeders < options.minSeeders) return;
    allTorrents.push(torrent);
  });

  if (options.maxResults && allTorrents.length > options.maxResults) {
    return allTorrents.slice(0, options.maxResults);
  }

  return allTorrents;
}

// ── Exports ───────────────────────────────────────────────────────────────────

hiddenBay.getDetails = hiddenBayDetails;
hiddenBay.browse     = hiddenBayBrowse;

module.exports = hiddenBay;
