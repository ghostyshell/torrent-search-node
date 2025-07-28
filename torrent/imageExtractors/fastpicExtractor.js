const cheerio = require('cheerio');
const axios = require('axios');

// Extract direct image URL from fastpic.org
async function getFastpicDirectUrl(url) {
  try {
    // Handle different fastpic URL formats
    // View URLs: https://fastpic.org/view/125/2025/0630/_8f8065ead21a577bc534c04d996be983.jpg.html
    // Direct URLs: https://i125.fastpic.org/big/2025/0630/13/09a2b3698a8c098ff135929c5102d213.jpg

    // If it's already a direct image URL from fastpic.org, return it
    // Handle URLs with query parameters like ?md5=...&expires=...
    if (
      url.includes('fastpic.org') &&
      url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i) &&
      !url.includes('.html')
    ) {
      return url;
    }

    // Handle view URLs that end with .html
    if (url.includes('fastpic.org/view/') && url.includes('.html')) {
      // First try scraping the page to get the actual direct URL with query parameters
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
          'img.main-image',
          'img[src*="fastpic.org"]',
          '.image-container img',
          '#main-image',
          'img.img-fluid',
          'img[onclick*="fullview"]',
          'a[href*="fullview"] img',
          'img[src*="?md5="]', // Look for images with md5 query params
        ];

        for (const selector of imageSelectors) {
          const imgElement = $(selector);
          const imgSrc = imgElement.attr('src');
          if (imgSrc && imgSrc.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
            const fullUrl = imgSrc.startsWith('http')
              ? imgSrc
              : imgSrc.startsWith('//')
              ? `https:${imgSrc}`
              : `https://fastpic.org${imgSrc}`;
            return fullUrl;
          }
        }

        // Look for meta tags or other sources
        const ogImage = $('meta[property="og:image"]').attr('content');
        if (ogImage && ogImage.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
          const fullUrl = ogImage.startsWith('http')
            ? ogImage
            : `https:${ogImage}`;
          return fullUrl;
        }

        // Look for JavaScript variables or other sources that might contain the direct URL
        const scriptTags = $('script');
        for (let i = 0; i < scriptTags.length; i++) {
          const scriptContent = $(scriptTags[i]).html();
          if (scriptContent) {
            // Look for URLs with md5 and expires parameters in script content
            const urlMatch = scriptContent.match(
              /https?:\/\/i\d+\.fastpic\.org\/[^"'\s]+\.(jpg|jpeg|png|gif|webp)\?md5=[^"'\s]+&expires=\d+/g
            );
            if (urlMatch && urlMatch.length > 0) {
              return urlMatch[0];
            }
          }
        }

        // Look for links to full-size images
        const fullviewLink = $('a[href*="fullview"]').attr('href');
        if (fullviewLink) {
          const fullviewUrl = fullviewLink.startsWith('http')
            ? fullviewLink
            : `https://fastpic.org${fullviewLink}`;
          // Recursively process the fullview URL
          return await getFastpicDirectUrl(fullviewUrl);
        }
      } catch (scrapingError) {
        console.log(
          `Scraping failed for ${url}, trying URL pattern parsing: ${scrapingError.message}`
        );
      }

      // Fallback: Try to convert view URL to direct URL by parsing the URL structure
      const viewUrlMatch = url.match(
        /https?:\/\/fastpic\.org\/view\/(\d+)\/(\d{4})\/(\d{4})\/_([a-f0-9]+)\.(\w+)\.html/
      );
      if (viewUrlMatch) {
        const [, server, year, monthDay, hash, ext] = viewUrlMatch;
        // Try common fastpic direct URL patterns (though these may not have the query params)
        const directUrlPatterns = [
          `https://i${server}.fastpic.org/big/${year}/${monthDay}/${hash.substring(
            0,
            2
          )}/${hash}.${ext}`,
          `https://i${server}.fastpic.org/${year}/${monthDay}/${hash}.${ext}`,
          `https://fastpic.org/big/${year}/${monthDay}/${hash}.${ext}`,
        ];

        // Test each pattern
        for (const directUrl of directUrlPatterns) {
          try {
            const testResponse = await axios.head(directUrl, {
              timeout: 3000,
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.106 Safari/537.36',
              },
            });
            if (testResponse.status === 200) {
              return directUrl;
            }
          } catch (error) {
            continue;
          }
        }

        // If all direct URL attempts fail, try returning the first pattern anyway
        return directUrlPatterns[0];
      }
    }

    return null;
  } catch (error) {
    console.error(`Error extracting from fastpic.org: ${error.message}`);
    return null;
  }
}

module.exports = getFastpicDirectUrl;
