// Load environment variables
require('dotenv').config();

const express = require('express');
const combo = require('./torrent/COMBO');
const path = require('path');
const SQLiteCache = require('./cache/sqliteCache');
const googleImagesService = require('./services/googleImagesService');

let torrents = require('./torrent/torrents')();

const app = express();

// Initialize SQLite cache (async initialization)
let cache = null;
const initializeCache = async () => {
  try {
    cache = new SQLiteCache();
    await cache.initializeDatabase();
  } catch (error) {
    // Continue without cache - graceful degradation
  }
};

// Initialize cache on startup
initializeCache();

// Middleware for parsing JSON bodies
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Enhanced CORS middleware for video streaming and screenshot capture
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range'
  );
  res.header(
    'Access-Control-Expose-Headers',
    'Content-Range, Accept-Ranges, Content-Length, Content-Type'
  );

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// === CACHE API ENDPOINTS ===

// Get cache statistics
app.get('/api/cache/stats', async (req, res) => {
  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const stats = await cache.getStats();
    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cache statistics',
      message: error.message,
    });
  }
});

// Clear all caches
app.post('/api/cache/clear', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    await cache.clearAll();
    res.json({
      success: true,
      message: 'All caches cleared successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clear caches',
      message: error.message,
    });
  }
});

// Store cover image
app.post('/api/cache/cover-image', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { torrent, imageUrl, imageData } = req.body;

    if (!torrent || !imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: torrent, imageUrl',
      });
    }

    // Convert base64 image data to buffer if provided
    let imageBuffer = null;
    if (imageData) {
      const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    }

    const success = await cache.setCoverImage(torrent, imageUrl, imageBuffer);

    if (success) {
      res.json({
        success: true,
        message: 'Cover image cached successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to cache cover image',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cache cover image',
      message: error.message,
    });
  }
});

// Get cover image
app.get('/api/cache/cover-image/:torrentKey', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const torrentKey = req.params.torrentKey;
    const torrent = { Name: torrentKey }; // Simplified torrent object

    const imageData = await cache.getCoverImage(torrent);

    if (imageData) {
      if (imageData.type === 'blob') {
        res.setHeader('Content-Type', imageData.mimeType || 'image/jpeg');
        res.send(imageData.data);
      } else {
        res.json({
          success: true,
          imageUrl: imageData.imageUrl,
          type: 'url',
        });
      }
    } else {
      res.status(404).json({
        success: false,
        error: 'Cover image not found',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cover image',
      message: error.message,
    });
  }
});

// Store stream URL
app.post('/api/cache/stream-url', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { magnetLink, streamData } = req.body;

    if (!magnetLink || !streamData || !streamData.streamUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: magnetLink, streamData.streamUrl',
      });
    }

    const success = await cache.setStreamUrl(magnetLink, streamData);

    if (success) {
      res.json({
        success: true,
        message: 'Stream URL cached successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to cache stream URL',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cache stream URL',
      message: error.message,
    });
  }
});

// Get stream URL
app.get('/api/cache/stream-url/:magnetHash', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const magnetHash = req.params.magnetHash; // This is just the hash now
    const streamData = await cache.getStreamUrlByHash(magnetHash);

    if (streamData) {
      res.json({
        success: true,
        ...streamData,
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Stream URL not found',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get stream URL',
      message: error.message,
    });
  }
});

// Add favorite
app.post('/api/cache/favorites', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { torrent } = req.body;

    if (!torrent) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: torrent',
      });
    }

    const success = await cache.addFavorite(torrent);

    if (success) {
      res.json({
        success: true,
        message: 'Favorite added successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to add favorite',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to add favorite',
      message: error.message,
    });
  }
});

// Get favorites
app.get('/api/cache/favorites', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const favorites = await cache.getFavorites();
    res.json({
      success: true,
      favorites,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get favorites',
      message: error.message,
    });
  }
});

// Remove favorite
app.delete('/api/cache/favorites', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { torrent } = req.body;

    if (!torrent) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: torrent',
      });
    }

    const success = await cache.removeFavorite(torrent);

    if (success) {
      res.json({
        success: true,
        message: 'Favorite removed successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Favorite not found',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to remove favorite',
      message: error.message,
    });
  }
});

// === CACHED LINKS API ENDPOINTS ===

// Add cached link
app.post('/api/cache/cached-links', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { url, title } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: url',
      });
    }

    const cachedLink = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      url,
      title: title || extractTitleFromUrl(url),
      dateAdded: new Date().toISOString(),
    };

    const success = await cache.addCachedLink(cachedLink);

    if (success) {
      res.json({
        success: true,
        message: 'Link cached successfully',
        cachedLink,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to cache link',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cache link',
      message: error.message,
    });
  }
});

// Get cached links
app.get('/api/cache/cached-links', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const cachedLinks = await cache.getCachedLinks();
    res.json({
      success: true,
      cachedLinks,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cached links',
      message: error.message,
    });
  }
});

// Remove cached link
app.delete('/api/cache/cached-links/:id', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: id',
      });
    }

    const success = await cache.removeCachedLink(id);

    if (success) {
      res.json({
        success: true,
        message: 'Cached link removed successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Cached link not found',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to remove cached link',
      message: error.message,
    });
  }
});

// Update cached link
app.put('/api/cache/cached-links/:id', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  if (!cache) {
    return res.status(503).json({
      success: false,
      error: 'Cache not available',
    });
  }

  try {
    const { id } = req.params;
    const updates = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: id',
      });
    }

    const success = await cache.updateCachedLink(id, updates);

    if (success) {
      res.json({
        success: true,
        message: 'Cached link updated successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Cached link not found',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update cached link',
      message: error.message,
    });
  }
});

// Helper function to extract title from URL
function extractTitleFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    const path = urlObj.pathname;

    if (path && path !== '/') {
      const pathParts = path.split('/').filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart) {
        return `${hostname}/${lastPart}`;
      }
    }

    return hostname;
  } catch {
    return 'Cached Link';
  }
}

// === END CACHE API ENDPOINTS ===

// New endpoint for torrent details (must come before the general search route)
app.get('/api/torrent-details/:website/:torrentUrl', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  const website = req.params.website.toLowerCase();
  const torrentUrl = decodeURIComponent(req.params.torrentUrl);

  if (
    website === 'piratebay' &&
    torrents[website] &&
    torrents[website].getDetails
  ) {
    torrents[website]
      .getDetails(torrentUrl)
      .then((details) => {
        res.json(details);
      })
      .catch((error) => {
        res.status(500).json({
          error: 'Failed to fetch torrent details',
          message: error.message,
        });
      });
  } else {
    res.status(404).json({
      error: `Torrent details not supported for "${website}" or website not found`,
      debug: {
        website,
        hasModule: !!torrents[website],
        hasGetDetails: !!(torrents[website] && torrents[website].getDetails),
      },
    });
  }
});

// Google Images search endpoint
app.get('/api/google-images/search', async (req, res) => {
  try {
    const { q: query, limit = 20 } = req.query;

    if (!query) {
      return res.status(400).json({
        error: 'Query parameter "q" is required',
      });
    }

    const results = await googleImagesService.searchImages(
      query,
      parseInt(limit)
    );

    res.json({
      success: true,
      query: query,
      results: results,
      count: results.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Google Images search suggestions endpoint
app.get('/api/google-images/suggestions', (req, res) => {
  try {
    const { q: query } = req.query;

    if (!query) {
      return res.status(400).json({
        error: 'Query parameter "q" is required',
      });
    }

    const suggestions = googleImagesService.generateSearchSuggestions(query);

    res.json({
      success: true,
      query: query,
      suggestions: suggestions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Pixhost image upload proxy endpoint
app.post('/api/pixhost/upload', async (req, res) => {
  try {
    const { imageUrl, imageData } = req.body;

    if (!imageUrl && !imageData) {
      return res.status(400).json({
        success: false,
        error: 'Either imageUrl or imageData is required',
      });
    }

    const fetch = require('node-fetch');
    const FormData = require('form-data');

    let imageBuffer;
    
    if (imageData) {
      // Handle base64 encoded image data
      const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      // Fetch image from URL
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      imageBuffer = await response.buffer();
    }

    // Create form data for pixhost API
    const form = new FormData();
    form.append('img', imageBuffer, {
      filename: 'image.jpg',
      contentType: 'image/jpeg',
    });
    form.append('content_type', '0'); // 0 for SFW
    form.append('max_th_size', '420');

    // Upload to pixhost
    const pixhostResponse = await fetch('https://api.pixhost.to/images', {
      method: 'POST',
      body: form,
      headers: {
        'Accept': 'application/json',
        ...form.getHeaders(),
      },
    });

    if (!pixhostResponse.ok) {
      const errorText = await pixhostResponse.text();
      throw new Error(`Pixhost API error: ${pixhostResponse.status} ${errorText}`);
    }

    const result = await pixhostResponse.json();

    if (!result.show_url) {
      throw new Error('Invalid response from pixhost API');
    }

    // Convert show URL to direct image URL
    // https://pixhost.to/show/8325/636090636_image.jpg -> https://img1.pixhost.to/images/8325/636090636_image.jpg
    const directImageUrl = result.show_url.replace('https://pixhost.to/show/', 'https://img1.pixhost.to/images/');

    res.json({
      success: true,
      originalUrl: imageUrl,
      pixhostUrl: directImageUrl,
      pixhostShowUrl: result.show_url, // Keep original show URL for reference
      thumbnailUrl: result.th_url,
    });

  } catch (error) {
    console.error('Pixhost upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.use('/api/:website/:query/:page?', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  let website = req.params.website.toLowerCase();
  let query = req.params.query;
  let page = req.params.page;

  // Extract query parameters for filtering options
  const options = {
    minSeeders: req.query.minSeeders ? parseInt(req.query.minSeeders) : null,
    maxResults: req.query.maxResults ? parseInt(req.query.maxResults) : null,
  };

  if (website == 'all') {
    combo(query, page, options).then((v) => {
      res.json(v);
    });
  } else if (torrents[website]) {
    torrents[website](query, page, options).then((v) => {
      res.json(v);
    });
  } else {
    res.json({
      error: `Please select "${Object.keys(torrents).join(' | ')}"`,
    });
  }
});

app.get('/api/torrents', (req, res) => {
  res.json(Object.keys(torrents));
});

app.use('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT);

// Cleanup on server shutdown
process.on('SIGINT', () => {
  cache.cleanup();
  cache.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cache.cleanup();
  cache.close();
  process.exit(0);
});

// Run cleanup every hour
setInterval(() => {
  cache.cleanup();
}, 60 * 60 * 1000); // 1 hour
