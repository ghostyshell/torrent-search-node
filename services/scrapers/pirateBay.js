const cheerio = require('cheerio');
const axios = require('axios');
const { extractImageLinks } = require('../imageExtractorService');

async function pirateBay(query, page = '1', options = {}) {
  const allTorrents = [];

  // Default sort: 7 = seeders desc, 3 = date desc, 99 = name, 8 = size
  // Default category: 0 = all, 100 = audio, 200 = video, 300 = apps, 400 = games, 500 = porn, 507 = porn HD
  const sort = options.sort || '7';
  const category = options.category || '0';

  const url = `https://thehiddenbay.com/search/${query}/${page}/${sort}/${category}`;
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

    const seedersText = $(element).find('td').eq(2).text();
    const leechersText = $(element).find('td').eq(3).text();

    // Parse seeders as number for filtering
    const seeders = parseInt(seedersText) || 0;
    const leechers = parseInt(leechersText) || 0;

    const torrent = {
      Name: $(element).find('a.detLink').text(),
      Size: size,
      DateUploaded: date,
      Category: $(element).find('td.vertTh center a').eq(0).text(),
      Seeders: seedersText,
      Leechers: leechersText,
      UploadedBy: uploader,
      Url: $(element).find('a.detLink').attr('href'),
      Magnet: $(element).find('td div.detName').next().attr('href'),
      Source: 'piratebay',
    };

    // Filter by minimum seeders if specified
    if (options.minSeeders && seeders < options.minSeeders) {
      return; // Skip this torrent
    }

    if (torrent.Name.length) {
      allTorrents.push(torrent);
    }
  });

  // Apply maxResults filter if specified
  if (options.maxResults && allTorrents.length > options.maxResults) {
    return allTorrents.slice(0, options.maxResults);
  }

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

    const imageLinks = await extractImageLinks(description);

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

    return {
      description: 'Failed to load description',
      files: [],
      comments: [],
      images: [],
      error: error.message,
    };
  }
}

/**
 * Browse a category without a search query.
 * URL format: https://thehiddenbay.com/browse/{category}/{page}/{sort}
 */
async function pirateBayBrowse(category = '507', page = '1', sort = '3', options = {}) {
  const allTorrents = [];
  const url = `https://thehiddenbay.com/browse/${category}/${page}/${sort}`;

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

    const seedersText = $(element).find('td').eq(2).text();
    const seeders = parseInt(seedersText) || 0;

    const torrent = {
      Name: $(element).find('a.detLink').text(),
      Size: size,
      DateUploaded: date,
      Category: $(element).find('td.vertTh center a').eq(0).text(),
      Seeders: seedersText,
      Leechers: $(element).find('td').eq(3).text(),
      UploadedBy: uploader,
      Url: $(element).find('a.detLink').attr('href'),
      Magnet: $(element).find('td div.detName').next().attr('href'),
      Source: 'piratebay',
    };

    if (options.minSeeders && seeders < options.minSeeders) return;
    if (torrent.Name.length) allTorrents.push(torrent);
  });

  if (options.maxResults && allTorrents.length > options.maxResults) {
    return allTorrents.slice(0, options.maxResults);
  }

  return allTorrents;
}

// Attach methods to the main function
pirateBay.getDetails = pirateBayDetails;
pirateBay.browse = pirateBayBrowse;

module.exports = pirateBay;
