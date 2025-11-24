const express = require('express');
const router = express.Router();
const torrentController = require('../controllers/torrentController');

const setupTorrentRoutes = (storageProvider) => {
  // Get torrent details
  // Route: GET /api/torrents/details/:website/:torrentUrl
  router.get(
    '/details/:website/:torrentUrl',
    torrentController.getTorrentDetails
  );

  // Get available torrent websites
  // Route: GET /api/torrents/websites or /api/torrents (backward compat)
  router.get('/websites', torrentController.getTorrentWebsites);
  router.get('/', torrentController.getTorrentWebsites); // backward compat for /api/torrents

  // Advanced search endpoint
  // Route: POST /api/torrents/advanced-search
  router.post('/advanced-search', torrentController.advancedSearch);

  // Single website search endpoint
  // Route: GET /api/torrents/search/:website/:query/:page?
  router.get(
    '/search/:website/:query/:page?',
    torrentController.searchSingleWebsite
  );

  // Backward compatibility for old route: /api/torrent-details/:website/:torrentUrl
  router.get(
    '/torrent-details/:website/:torrentUrl',
    torrentController.getTorrentDetails
  );

  // Main search endpoint (catch-all for backward compatibility)
  // Route: GET /api/torrents/:website/:query/:page? or /api/:website/:query/:page?
  // Note: This should be last to avoid conflicts with other routes
  router.get('/:website/:query/:page?', torrentController.searchTorrents);

  return router;
};

module.exports = setupTorrentRoutes;
