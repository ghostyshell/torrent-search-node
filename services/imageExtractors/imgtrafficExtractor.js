/**
 * imgtraffic.com Image Extractor
 * 
 * Extracts direct image URLs from imgtraffic.com hosting pages.
 * These pages have URLs like: https://imgtraffic.com/i-1/2025/07/24/688278ecbe629.jpeg.html
 * The direct image is usually at a similar path without .html or in an img tag.
 */

const cheerio = require('cheerio');
const axios = require('axios');

/**
 * Extract direct image URL from imgtraffic.com page
 * @param {string} url - imgtraffic.com page URL (ending in .html)
 * @returns {Promise<string|null>} Direct image URL or null
 */
async function getImgtrafficDirectUrl(url) {
  try {
    // If it's already a direct image URL (no .html), return as-is
    if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i) && !url.endsWith('.html')) {
      return url;
    }

    // Convert .html URL to direct image URL
    // https://imgtraffic.com/i-1/2025/07/24/688278ecbe629.jpeg.html
    // -> https://imgtraffic.com/i-1/2025/07/24/688278ecbe629.jpeg
    if (url.endsWith('.html')) {
      const directUrl = url.replace(/\.html$/, '');
      // Verify this is a valid image extension
      if (directUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        return directUrl;
      }
    }

    // If simple conversion doesn't work, fetch the page and extract
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://imgtraffic.com/',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    // Look for the main image in various possible selectors
    const imageSelectors = [
      'img#image',
      'img.main-image',
      'img.img-fluid',
      '.image-container img',
      '#image-viewer img',
      'img[src*="imgtraffic.com"]',
      // Look for any large image
      'img[src$=".jpg"]',
      'img[src$=".jpeg"]',
      'img[src$=".png"]',
      'img[src$=".gif"]',
      'img[src$=".webp"]',
    ];

    for (const selector of imageSelectors) {
      const $img = $(selector);
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

    // Also check for og:image meta tag
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && ogImage.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
      return ogImage;
    }

    // Fallback: try removing .html extension
    if (url.endsWith('.html')) {
      return url.replace(/\.html$/, '');
    }

    return null;
  } catch (error) {
    console.warn(`Failed to extract image from imgtraffic.com: ${url}`, error.message);
    
    // Fallback: try removing .html extension even on error
    if (url.endsWith('.html')) {
      return url.replace(/\.html$/, '');
    }
    
    return null;
  }
}

module.exports = getImgtrafficDirectUrl;

