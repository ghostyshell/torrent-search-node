/**
 * imgtraffic.com Image Extractor
 *
 * Extracts direct image URLs from imgtraffic.com hosting pages.
 * Page URLs like: https://imgtraffic.com/i-1/2025/07/24/688278ecbe629.jpeg.html
 * Actual images at: https://imgtraffic.com/1/2025/07/24/688278ecbe629.jpeg
 *
 * IMPORTANT: The /i-1/, /z-1/, /1s/ paths are NOT direct image URLs.
 * We must fetch the HTML page to find the real image at /1/ path.
 */

const cheerio = require('cheerio');
const axios = require('axios');

/**
 * Extract direct image URL from imgtraffic.com page
 * @param {string} url - imgtraffic.com URL (page or image)
 * @returns {Promise<string|null>} Direct image URL or null
 */
async function getImgtrafficDirectUrl(url) {
  try {
    // If it's already a direct image URL at /1/ path, return as-is
    // Pattern: https://imgtraffic.com/1/2025/07/24/filename.jpeg
    if (url.match(/imgtraffic\.com\/1\/[^\/]+\//) && url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return url;
    }

    // Determine the page URL to fetch
    let pageUrl = url;

    // If URL ends with .html, it's already a page URL
    // If URL has /i-1/, /z-1/, /1s/ paths without .html, add .html
    if (!url.endsWith('.html')) {
      if (url.match(/\/(i-1|z-1|1s)\//)) {
        pageUrl = url + '.html';
      } else if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        // It's some other direct image URL, just return it
        return url;
      }
    }

    // Fetch the HTML page to extract the real image URL
    const response = await axios.get(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        Referer: 'https://imgtraffic.com/',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    // Look for the main image - priority order
    const imageSelectors = [
      'img[src*="imgtraffic.com/1/"]', // Direct /1/ path images (highest priority)
      'img#image',
      'img.main-image',
      '.image-container img',
      '#image-viewer img',
      'img[src*="imgtraffic.com"]',
    ];

    for (const selector of imageSelectors) {
      const $img = $(selector).first();
      const imgSrc = $img.attr('src');
      if (imgSrc && imgSrc.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
        // Make sure it's a full URL
        if (imgSrc.startsWith('http')) {
          return imgSrc;
        } else if (imgSrc.startsWith('//')) {
          return `https:${imgSrc}`;
        } else if (imgSrc.startsWith('/')) {
          return `https://imgtraffic.com${imgSrc}`;
        }
      }
    }

    // Check og:image meta tag
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && ogImage.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
      return ogImage;
    }

    // Last resort: try to find any image URL in the HTML
    const html = response.data;
    const imgMatch = html.match(
      /https?:\/\/imgtraffic\.com\/1\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp)/i
    );
    if (imgMatch) {
      return imgMatch[0];
    }

    console.warn(`Could not find image in imgtraffic.com page: ${pageUrl}`);
    return null;
  } catch (error) {
    console.warn(
      `Failed to extract image from imgtraffic.com: ${url}`,
      error.message
    );

    // Fallback: Try converting /i-1/ to /1/ path directly
    // This is a guess and may not always work
    if (url.includes('/i-1/')) {
      const fallback = url.replace('/i-1/', '/1/').replace(/\.html$/, '');
      if (fallback.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        return fallback;
      }
    }

    return null;
  }
}

module.exports = getImgtrafficDirectUrl;
