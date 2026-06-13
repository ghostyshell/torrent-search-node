/**
 * pornrips.js
 * PornRips.to scraper for adult scene releases.
 *
 * PornRips is a WordPress-style release blog. Listings live at:
 *   - Browse/search: https://pornrips.to/page/{page}/?s={query}
 *   - Page 1 with a query: https://pornrips.to/?s={query}
 *   - Page 1 with no query: https://pornrips.to/
 *
 * Each listing item is an <article> inside <section id="primary">.
 * The .torrent file URL is not exposed in the listing; it lives on the detail
 * page, so we fetch the detail page to extract it. If a magnet link is also
 * present we prefer that.
 *
 * Seeders/leechers are not published by the site, so they are reported as 0.
 */

'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://pornrips.to';
const HTTP_TIMEOUT = 15000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate',
  Connection: 'keep-alive',
};

/**
 * Search PornRips releases.
 *
 * @param {string} query
 * @param {string|number} page
 * @param {object} options
 * @returns {Promise<object[]|null>}
 */
async function pornRips(query, page = '1', options = {}) {
  return fetchListings(query, parseInt(page, 10) || 1, options);
}

/**
 * Browse latest PornRips releases (no search query).
 * Category and sort are ignored — listings are always newest-first.
 *
 * @param {string} _category – unused (kept for browse API compatibility)
 * @param {string|number} page
 * @param {string} _sort – unused
 * @param {object} options
 * @returns {Promise<object[]|null>}
 */
async function pornRipsBrowse(_category = 'all', page = '1', _sort = '3', options = {}) {
  return fetchListings('', parseInt(page, 10) || 1, options);
}

async function fetchListings(query, page, options = {}) {
  const qs = query ? `?s=${encodeURIComponent(query).replace(/%20/g, '+')}` : '';
  const pagePath = page > 1 ? `/page/${page}` : '';
  const url = `${BASE_URL}${pagePath}/${qs}`;

  try {
    const html = await fetchPage(url);
    if (!html) return null;

    const $ = cheerio.load(html);
    if (/Nothing Found/i.test($('section#primary').text() || $('body').text())) {
      return [];
    }

    const articles = $('section#primary article').toArray();
    const results = [];

    for (const article of articles) {
      const entry = parseArticle($, article);
      if (!entry.title) continue;

      const download = entry.detailUrl
        ? await fetchDownloadLinks(entry.detailUrl, url)
        : {};

      const magnet = download.magnetLink || '';
      const torrentUrl = download.torrentUrl || entry.detailUrl || '';

      const torrent = {
        Name: entry.title,
        Size: entry.size,
        Seeders: '0',
        Leechers: '0',
        Url: torrentUrl,
        Magnet: magnet,
        Source: 'pornrips',
      };

      results.push(torrent);
    }

    if (options.maxResults && results.length > options.maxResults) {
      return results.slice(0, options.maxResults);
    }

    return results;
  } catch (err) {
    console.error('[pornrips] search error:', err.message);
    return null;
  }
}

async function fetchPage(url, referer) {
  try {
    const headers = { ...HEADERS };
    if (referer) headers.Referer = referer;

    const res = await axios.get(url, { headers, timeout: HTTP_TIMEOUT, maxRedirects: 5 });
    return res.data;
  } catch (err) {
    console.error('[pornrips] fetch error:', err.message);
    return null;
  }
}

function parseArticle($, article) {
  const $art = $(article);

  const $titleLink = $art.find('header h2 a').first();
  const title = $titleLink.text().trim();
  const detailPath = $titleLink.attr('href') || '';
  const detailUrl = detailPath.startsWith('http') ? detailPath : `${BASE_URL}${detailPath}`;

  let size = 'Unknown';
  const metaText = $art.find('.wrapper-excerpt-content p, .entry-summary p, p').text() || '';
  const sizeMatch = metaText.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB|TB))/i);
  if (sizeMatch) size = sizeMatch[0];

  return { title, detailUrl, size };
}

async function fetchDownloadLinks(detailUrl, referer) {
  try {
    const html = await fetchPage(detailUrl, referer);
    if (!html) return {};

    const $ = cheerio.load(html);

    const magnetLink = $('a[href^="magnet:?xt=urn:btih:"]').first().attr('href') || '';
    if (magnetLink) {
      return { magnetLink };
    }

    const torrentUrl = $('a[href$=".torrent"]').first().attr('href') || '';
    if (torrentUrl) {
      return { torrentUrl: absoluteUrl(torrentUrl, detailUrl) };
    }

    return {};
  } catch (err) {
    console.error('[pornrips] detail fetch error:', err.message);
    return {};
  }
}

function absoluteUrl(src, base) {
  if (!src) return src;
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
    return src.startsWith('//') ? `https:${src}` : src;
  }
  try {
    return new URL(src, base).toString();
  } catch (_) {
    return src;
  }
}

pornRips.browse = pornRipsBrowse;

module.exports = pornRips;
