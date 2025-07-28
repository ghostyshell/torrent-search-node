const trafficImageExtractor = require('./trafficImageExtractor');
const imgbbExtractor = require('./imgbbExtractor');
const postimgExtractor = require('./postimgExtractor');
const imgurExtractor = require('./imgurExtractor');
const fastpicExtractor = require('./fastpicExtractor');
const xxxwebdlxxxExtractor = require('./xxxwebdlxxxExtractor');

// Function to extract image links from description
async function extractImageLinks(description) {
  const imageLinks = [];

  // Regular expression to find image hosting URLs
  const imageHostPatterns = [
    /https?:\/\/trafficimage\.club\/image\/[a-zA-Z0-9]+/g,
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

  // Extract all potential image URLs from description
  const foundUrls = new Set();
  imageHostPatterns.forEach((pattern) => {
    const matches = description.match(pattern);
    if (matches) {
      matches.forEach((url) => foundUrls.add(url));
    }
  });

  // Process each URL to get the direct image link
  for (const url of foundUrls) {
    try {
      const directImageUrl = await getDirectImageUrl(url);
      if (directImageUrl) {
        imageLinks.push({
          originalUrl: url,
          directUrl: directImageUrl,
        });
      }
    } catch (error) {
      console.error(`Error processing image URL ${url}:`, error.message);
      // Still add the original URL in case it's already a direct link
      if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        imageLinks.push({
          originalUrl: url,
          directUrl: url,
        });
      }
    }
  }

  return imageLinks;
}

// Function to get direct image URL from image hosting services
async function getDirectImageUrl(url) {
  try {
    // If it's already a direct image URL, return it
    // Handle URLs with query parameters like ?md5=...&expires=...
    if (url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
      return url;
    }

    // Handle different image hosting services
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

    return null;
  } catch (error) {
    console.error(`Error getting direct URL for ${url}:`, error.message);
    return null;
  }
}

module.exports = {
  extractImageLinks,
  getDirectImageUrl,
};
