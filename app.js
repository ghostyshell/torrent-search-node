const express = require('express');
const combo = require('./torrent/COMBO');
const path = require('path');
const SQLiteCache = require('./cache/sqliteCache');

let torrents = require('./torrent/torrents')();

const app = express();

// Initialize SQLite cache (async initialization)
let cache = null;
const initializeCache = async () => {
  try {
    cache = new SQLiteCache();
    await cache.initializeDatabase();
    console.log('✅ Cache initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize cache:', error);
    // Continue without cache - graceful degradation
  }
};

// Initialize cache on startup
initializeCache();

// Middleware for parsing JSON bodies
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

// === CACHE API ENDPOINTS ===

// Get cache statistics
app.get('/api/cache/stats', async (req, res) => {
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

  console.log(`Fetching details for ${website}: ${torrentUrl}`);
  console.log('Available torrents:', Object.keys(torrents));
  console.log('Torrent module for', website, ':', torrents[website]);
  console.log(
    'Has getDetails?',
    torrents[website] && typeof torrents[website].getDetails === 'function'
  );

  if (
    website === 'piratebay' &&
    torrents[website] &&
    torrents[website].getDetails
  ) {
    torrents[website]
      .getDetails(torrentUrl)
      .then((details) => {
        console.log('Details fetched successfully');
        res.json(details);
      })
      .catch((error) => {
        console.error('Error fetching details:', error);
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
      console.log(v);
      res.json(v);
    });
  } else if (torrents[website]) {
    torrents[website](query, page, options).then((v) => {
      console.log(v);
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
console.log('Listening on PORT : ', PORT);
app.listen(PORT);

// Cleanup on server shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Server shutting down...');
  cache.cleanup();
  cache.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Server terminating...');
  cache.cleanup();
  cache.close();
  process.exit(0);
});

// Run cleanup every hour
setInterval(() => {
  console.log('⏰ Running scheduled cache cleanup...');
  cache.cleanup();
}, 60 * 60 * 1000); // 1 hour
