const cheerio = require('cheerio');
const axios = require('axios');

// Extract direct image URL from trafficimage.club
async function getTrafficImageDirectUrl(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.106 Safari/537.36',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    // Look for the actual image in various possible selectors
    const imageSelectors = [
      'img#image',
      '.image-container img',
      '#image-viewer img',
      'img[src*="trafficimage.club"]',
      'img.img-fluid',
      'img.main-image',
    ];

    for (const selector of imageSelectors) {
      const imgSrc = $(selector).attr('src');
      if (imgSrc && imgSrc.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        return imgSrc.startsWith('http')
          ? imgSrc
          : `https://trafficimage.club${imgSrc}`;
      }
    }

    return null;
  } catch (error) {

    return null;
  }
}

module.exports = getTrafficImageDirectUrl;
