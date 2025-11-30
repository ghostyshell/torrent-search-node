/**
 * Image Extractor Service
 *
 * This service handles extraction of images from torrent descriptions and image hosting services.
 * It identifies image URLs from various hosting platforms and converts them to direct image links.
 */

const trafficImageExtractor = require('./imageExtractors/trafficImageExtractor');
const imgtrafficExtractor = require('./imageExtractors/imgtrafficExtractor');
const imgbbExtractor = require('./imageExtractors/imgbbExtractor');
const postimgExtractor = require('./imageExtractors/postimgExtractor');
const imgurExtractor = require('./imageExtractors/imgurExtractor');
const fastpicExtractor = require('./imageExtractors/fastpicExtractor');
const xxxwebdlxxxExtractor = require('./imageExtractors/xxxwebdlxxxExtractor');

/**
 * Supported image hosting patterns
 * Each pattern is designed to match URLs from specific image hosting services
 */
const IMAGE_HOST_PATTERNS = [
  /https?:\/\/trafficimage\.club\/image\/[a-zA-Z0-9]+/g,
  // imgtraffic.com - pages ending in .jpeg.html, .jpg.html, etc.
  // Use [^h] or non-http pattern to avoid matching into next concatenated URL
  /https?:\/\/imgtraffic\.com\/[a-zA-Z0-9\-\/]+\.(jpg|jpeg|png|gif|webp)\.html/g,
  // imgtraffic.com - direct image URLs (stop before next http)
  /https?:\/\/imgtraffic\.com\/[a-zA-Z0-9\-\/]+\.(jpg|jpeg|png|gif|webp)(?![a-zA-Z])/g,
  /https?:\/\/imgbb\.com\/[a-zA-Z0-9]+/g,
  /https?:\/\/postimg\.cc\/[a-zA-Z0-9]+/g,
  /https?:\/\/imgur\.com\/[a-zA-Z0-9]+/g,
  /https?:\/\/i\.imgur\.com\/[a-zA-Z0-9]+\.(jpg|jpeg|png|gif|webp)/g,
  /https?:\/\/i\.postimg\.cc\/[a-zA-Z0-9]+\/[^.\s]+\.(jpg|jpeg|png|gif|webp)/g,
  /https?:\/\/fastpic\.org\/view\/\d+\/\d{4}\/\d{4}\/_[a-zA-Z0-9]+\.(jpg|jpeg|png|gif|webp)\.html/g,
  /https?:\/\/i\d+\.fastpic\.org\/[^.\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?/g,
  /https?:\/\/xxxwebdlxxx\.(top|org)\/img-[a-zA-Z0-9]+\.html/g,
  /https?:\/\/[^.\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?/g,
];

/**
 * Extract image links from a text description
 * @param {string} description - Text containing potential image URLs
 * @returns {Promise<Array>} Array of objects with originalUrl and directUrl
 */
async function extractImageLinks(description) {
  if (!description || typeof description !== 'string') {
    return [];
  }

  const imageLinks = [];
  const seenDirectUrls = new Set(); // Track unique direct URLs to avoid duplicates

  // Extract all potential image URLs from description using patterns
  const foundUrls = new Set();
  IMAGE_HOST_PATTERNS.forEach((pattern) => {
    const matches = description.match(pattern);
    if (matches) {
      matches.forEach((url) => foundUrls.add(url));
    }
  });

  // Process each URL to get the direct image link
  for (const url of foundUrls) {
    try {
      const directImageUrl = await getDirectImageUrl(url);
      if (directImageUrl && !seenDirectUrls.has(directImageUrl)) {
        seenDirectUrls.add(directImageUrl);
        imageLinks.push({
          originalUrl: url,
          directUrl: directImageUrl,
        });
      }
    } catch (error) {
      console.warn(`Failed to extract direct image URL from: ${url}`, error.message);

      // Still add the original URL in case it's already a direct link
      if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i) && !seenDirectUrls.has(url)) {
        seenDirectUrls.add(url);
        imageLinks.push({
          originalUrl: url,
          directUrl: url,
        });
      }
    }
  }

  return imageLinks;
}

/**
 * Get direct image URL from an image hosting service URL
 * @param {string} url - Image hosting service URL
 * @returns {Promise<string|null>} Direct image URL or null if extraction fails
 */
async function getDirectImageUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    // Route imgtraffic.com URLs through extractor FIRST
    // This is important because /i-1/, /z-1/, /1s/ paths are NOT direct image URLs
    if (url.includes('imgtraffic.com')) {
      return await imgtrafficExtractor(url);
    }

    // If it's already a direct image URL, return it
    // Handle URLs with query parameters like ?md5=...&expires=...
    if (url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
      return url;
    }

    // Route to appropriate extractor based on URL pattern
    if (url.includes('trafficimage.club')) {
      return await trafficImageExtractor(url);
    } else if (url.includes('imgbb.com')) {
      return await imgbbExtractor(url);
    } else if (url.includes('postimg.cc')) {
      return await postimgExtractor(url);
    } else if (url.includes('imgur.com') && !url.includes('i.imgur.com')) {
      return await imgurExtractor(url);
    } else if (url.includes('fastpic.org')) {
      return await fastpicExtractor(url);
    } else if (
      url.includes('xxxwebdlxxx.top') ||
      url.includes('xxxwebdlxxx.org')
    ) {
      return await xxxwebdlxxxExtractor(url);
    }

    // If no extractor matches, return null
    return null;
  } catch (error) {
    console.error(`Error extracting direct image URL from ${url}:`, error.message);
    return null;
  }
}

/**
 * Check if a URL is a direct image link
 * @param {string} url - URL to check
 * @returns {boolean} True if URL points directly to an image file
 */
function isDirectImageUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);
}

/**
 * Extract domain from URL
 * @param {string} url - Full URL
 * @returns {string|null} Domain name or null if invalid
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

module.exports = {
  // Main functions
  extractImageLinks,
  getDirectImageUrl,

  // Utility functions
  isDirectImageUrl,
  extractDomain,

  // Patterns for external use if needed
  IMAGE_HOST_PATTERNS,
};
