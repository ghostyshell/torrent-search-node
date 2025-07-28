const cheerio = require('cheerio');
const axios = require('axios');

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
    /https?:\/\/[^.\s]+\.(jpg|jpeg|png|gif|webp)/g,
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
    if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return url;
    }

    // Handle different image hosting services
    if (url.includes('trafficimage.club')) {
      return await getTrafficImageDirectUrl(url);
    } else if (url.includes('imgbb.com')) {
      return await getImgbbDirectUrl(url);
    } else if (url.includes('postimg.cc')) {
      return await getPostimgDirectUrl(url);
    } else if (url.includes('imgur.com') && !url.includes('i.imgur.com')) {
      return await getImgurDirectUrl(url);
    }

    return null;
  } catch (error) {
    console.error(`Error getting direct URL for ${url}:`, error.message);
    return null;
  }
}

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
    console.error(`Error extracting from trafficimage.club: ${error.message}`);
    return null;
  }
}

// Extract direct image URL from imgbb.com
async function getImgbbDirectUrl(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.106 Safari/537.36',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const imgSrc = $('img.image').attr('src') || $('#image').attr('src');

    if (imgSrc && imgSrc.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return imgSrc.startsWith('http') ? imgSrc : `https:${imgSrc}`;
    }

    return null;
  } catch (error) {
    console.error(`Error extracting from imgbb.com: ${error.message}`);
    return null;
  }
}

// Extract direct image URL from postimg.cc
async function getPostimgDirectUrl(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.106 Safari/537.36',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const imgSrc =
      $('#main-image').attr('src') || $('img.imagefield').attr('src');

    if (imgSrc && imgSrc.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return imgSrc.startsWith('http') ? imgSrc : `https:${imgSrc}`;
    }

    return null;
  } catch (error) {
    console.error(`Error extracting from postimg.cc: ${error.message}`);
    return null;
  }
}

// Extract direct image URL from imgur.com
async function getImgurDirectUrl(url) {
  try {
    // Convert imgur.com URLs to i.imgur.com direct URLs
    const imgurId = url.split('/').pop();
    const directUrl = `https://i.imgur.com/${imgurId}.jpg`;

    // Try different extensions
    const extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    for (const ext of extensions) {
      try {
        const testUrl = `https://i.imgur.com/${imgurId}.${ext}`;
        const response = await axios.head(testUrl, { timeout: 5000 });
        if (response.status === 200) {
          return testUrl;
        }
      } catch (e) {
        // Continue to next extension
      }
    }

    return directUrl; // Return default .jpg if none work
  } catch (error) {
    console.error(`Error extracting from imgur.com: ${error.message}`);
    return null;
  }
}

async function pirateBay(query, page = '1') {
  const allTorrents = [];
  const url = 'https://thehiddenbay.com/search/' + query + '/' + page + '/3/507';
  let html;
  try {
    html = await axios.get(url);
  } catch {
    return null;
  }
  const $ = cheerio.load(html.data);

  $('table#searchResult tr').each((_, element) => {
    const data = $(element)
      .find('font.detDesc')
      .text()
      .replace(/(Size|Uploaded)/gi, '')
      .replace(/ULed/gi, 'Uploaded')
      .split(',')
      .map((value) => value.trim());
    const date = data[0];
    const size = data[1];
    const uploader = $(element).find('font.detDesc a').text();

    const torrent = {
      Name: $(element).find('a.detLink').text(),
      Size: size,
      DateUploaded: date,
      Category: $(element).find('td.vertTh center a').eq(0).text(),
      Seeders: $(element).find('td').eq(2).text(),
      Leechers: $(element).find('td').eq(3).text(),
      UploadedBy: uploader,
      Url: $(element).find('a.detLink').attr('href'),
      Magnet: $(element).find('td div.detName').next().attr('href'),
    };

    if (torrent.Name.length) {
      allTorrents.push(torrent);
    }
  });

  return allTorrents;
}

async function pirateBayDetails(torrentUrl) {
  try {
    // Ensure the URL is complete
    const fullUrl = torrentUrl.startsWith('http')
      ? torrentUrl
      : `https://thehiddenbay.com${torrentUrl}`;

    const html = await axios.get(fullUrl);
    const $ = cheerio.load(html.data);

    // Extract torrent description
    const description =
      $('#details .nfo pre').text().trim() ||
      $('.nfo pre').text().trim() ||
      $('#description').text().trim() ||
      $('.description').text().trim() ||
      'No description available';

    // Extract image links from description
    console.log('Extracting image links from description...');
    const imageLinks = await extractImageLinks(description);
    console.log(`Found ${imageLinks.length} image links`);

    // Extract additional details
    const details = {
      description: description,
      files: [],
      comments: [],
      images: imageLinks, // Add image links to the response
    };

    // Extract file list if available
    $('table.torrentFileList tr').each((_, element) => {
      const fileName = $(element).find('td').first().text().trim();
      const fileSize = $(element).find('td').eq(1).text().trim();

      if (fileName && fileName !== 'File Name' && fileName !== '') {
        details.files.push({
          name: fileName,
          size: fileSize,
        });
      }
    });

    // Extract comments if available
    $('div.comment').each((_, element) => {
      const author = $(element).find('.username a').text().trim();
      const comment = $(element).find('.comment-text').text().trim();
      const date = $(element).find('.date').text().trim();

      if (comment) {
        details.comments.push({
          author: author || 'Anonymous',
          comment,
          date: date || '',
        });
      }
    });

    return details;
  } catch (error) {
    console.error('Error fetching torrent details:', error);
    return {
      description: 'Failed to load description',
      files: [],
      comments: [],
      images: [],
      error: error.message,
    };
  }
}

// Attach the getDetails function to the main function
pirateBay.getDetails = pirateBayDetails;

module.exports = pirateBay;
