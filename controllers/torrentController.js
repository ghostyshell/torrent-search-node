const express = require('express');
const router = express.Router();
const combo = require('../torrent/COMBO.js');

// Import torrent modules directly
const limeTorrent = require('../torrent/limeTorrent');
const nyaaSI = require('../torrent/nyaaSI');
const pirateBay = require('../torrent/pirateBay');
const torrentProject = require('../torrent/torrentProject');
const yts = require('../torrent/yts');

// Create torrents object
const torrents = {
  limetorrent: limeTorrent,
  nyaasi: nyaaSI,
  piratebay: pirateBay,
  torrentproject: torrentProject,
  yts: yts,
};

// Torrent controller for all torrent search and details endpoints
const torrentController = {
  // Get torrent details
  getTorrentDetails: (req, res) => {
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
  },

  // Search torrents
  searchTorrents: (req, res) => {
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

    if (website === 'all') {
      combo(query, page, options).then((v) => {
        res.json(v);
      });
    } else if (torrents[website]) {
      torrents[website](query, page, options).then((v) => {
        // Handle null responses by returning empty array
        res.json(v || []);
      });
    } else {
      res.json({
        error: `Please select "${Object.keys(torrents).join(' | ')}"`,
      });
    }
  },

  // Get available torrent websites
  getTorrentWebsites: (req, res) => {
    res.json(Object.keys(torrents));
  },

  // Single torrent search endpoint for specific websites
  searchSingleWebsite: (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const { website, query } = req.params;
    const page = req.params.page || 1;

    const websiteLower = website.toLowerCase();

    if (!torrents[websiteLower]) {
      return res.status(404).json({
        error: `Website "${website}" not supported`,
        availableWebsites: Object.keys(torrents),
      });
    }

    const options = {
      minSeeders: req.query.minSeeders ? parseInt(req.query.minSeeders) : null,
      maxResults: req.query.maxResults ? parseInt(req.query.maxResults) : null,
    };

    torrents[websiteLower](query, page, options)
      .then((results) => {
        res.json({
          success: true,
          website: websiteLower,
          query: query,
          page: page,
          results: results,
        });
      })
      .catch((error) => {
        res.status(500).json({
          success: false,
          error: 'Failed to search torrents',
          message: error.message,
          website: websiteLower,
          query: query,
        });
      });
  },

  // Advanced search with multiple filters
  advancedSearch: async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    try {
      const {
        query,
        websites = ['all'],
        minSeeders = 0,
        maxResults = 50,
        sortBy = 'seeders',
        sortOrder = 'desc',
      } = req.body;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Query is required',
        });
      }

      const searchOptions = {
        minSeeders: parseInt(minSeeders),
        maxResults: parseInt(maxResults),
        sortBy,
        sortOrder,
      };

      let results = [];

      if (websites.includes('all') || websites.length === 0) {
        // Search all websites using combo
        results = await combo(query, 1, searchOptions);
      } else {
        // Search specific websites
        const searchPromises = websites.map(async (website) => {
          const websiteLower = website.toLowerCase();
          if (torrents[websiteLower]) {
            try {
              return await torrents[websiteLower](query, 1, searchOptions);
            } catch (error) {
              console.error(`Error searching ${website}:`, error);
              return [];
            }
          }
          return [];
        });

        const websiteResults = await Promise.all(searchPromises);
        results = websiteResults.flat();
      }

      // Apply additional filtering and sorting
      if (minSeeders > 0) {
        results = results.filter(
          (torrent) => parseInt(torrent.Seeders) >= minSeeders
        );
      }

      // Sort results
      results.sort((a, b) => {
        let aValue = a[sortBy] || 0;
        let bValue = b[sortBy] || 0;

        if (sortBy === 'Seeders' || sortBy === 'Leechers') {
          aValue = parseInt(aValue) || 0;
          bValue = parseInt(bValue) || 0;
        }

        if (sortOrder === 'desc') {
          return bValue - aValue;
        } else {
          return aValue - bValue;
        }
      });

      // Limit results
      if (maxResults > 0) {
        results = results.slice(0, maxResults);
      }

      res.json({
        success: true,
        query: query,
        websites: websites,
        filters: searchOptions,
        totalResults: results.length,
        results: results,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Advanced search failed',
        message: error.message,
      });
    }
  },
};

// Export individual controller functions
module.exports = {
  getTorrentDetails: torrentController.getTorrentDetails,
  searchTorrents: torrentController.searchTorrents,
  getTorrentWebsites: torrentController.getTorrentWebsites,
  searchSingleWebsite: torrentController.searchSingleWebsite,
  advancedSearch: torrentController.advancedSearch,
  router: router,
};
