const cheerio = require('cheerio');
const axios = require('axios');

// Extract direct image URL from xxxwebdlxxx.top and xxxwebdlxxx.org
async function getXxxwebdlxxxDirectUrl(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.106 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    // Try different selectors to find the direct image URL
    let imgSrc = null;

    // Common selectors for image hosting sites
    const selectors = [
      'img#img',
      'img.image',
      'img[src*=".jpg"]',
      'img[src*=".jpeg"]',
      'img[src*=".png"]',
      'img[src*=".gif"]',
      'img[src*=".webp"]',
      '.image img',
      '#image img',
      '.main-image',
      'img.main-image',
      'img[alt*="image"]',
      'img[title*="image"]',
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const src = element.attr('src');
        if (src && src.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          imgSrc = src;
          break;
        }
      }
    }

    // If no image found with selectors, look for any img tag with valid image extension
    if (!imgSrc) {
      $('img').each((i, elem) => {
        const src = $(elem).attr('src');
        if (src && src.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          // Skip small images (likely icons, thumbnails, etc.)
          const width = $(elem).attr('width');
          const height = $(elem).attr('height');
          if (
            !width ||
            !height ||
            (parseInt(width) > 100 && parseInt(height) > 100)
          ) {
            imgSrc = src;
            return false; // break the loop
          }
        }
      });
    }

    if (imgSrc) {
      // Ensure the URL is absolute
      if (imgSrc.startsWith('//')) {
        imgSrc = `https:${imgSrc}`;
      } else if (imgSrc.startsWith('/')) {
        const urlObj = new URL(url);
        imgSrc = `${urlObj.protocol}//${urlObj.hostname}${imgSrc}`;
      } else if (!imgSrc.startsWith('http')) {
        const urlObj = new URL(url);
        imgSrc = `${urlObj.protocol}//${urlObj.hostname}/${imgSrc}`;
      }

      return imgSrc;
    }

    return null;
  } catch (error) {

    return null;
  }
}

module.exports = getXxxwebdlxxxDirectUrl;
