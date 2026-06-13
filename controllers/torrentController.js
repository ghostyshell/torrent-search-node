const express = require('express');
const router = express.Router();
const torrentScraperService = require('../services/torrentScraperService');

// Torrent controller for all torrent search and details endpoints
const torrentController = {
  // Get torrent details
  getTorrentDetails: async (req, res) => {

    const website = req.params.website.toLowerCase();
    const torrentUrl = decodeURIComponent(req.params.torrentUrl);

    try {
      const details = await torrentScraperService.getTorrentDetails(website, torrentUrl);
      res.json(details);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to fetch torrent details',
        message: error.message,
        website: website,
      });
    }
  },

  // Search torrents
  searchTorrents: async (req, res) => {

    let website = req.params.website.toLowerCase();
    let query = req.params.query;
    let page = req.params.page;

    // Extract query parameters for filtering options
    const options = {
      minSeeders: req.query.minSeeders ? parseInt(req.query.minSeeders) : null,
      maxResults: req.query.maxResults ? parseInt(req.query.maxResults) : null,
      includeCoverImages: req.query.includeCoverImages === 'true' || false,
      sort: req.query.sort || null,
      category: req.query.category || null,
    };

    try {
      let results;

      if (website === 'all') {
        results = await torrentScraperService.searchAllTorrents(query, page, options);
      } else {
        results = await torrentScraperService.searchTorrents(website, query, page, options);
      }

      // Add cover images to results if requested
      if (options.includeCoverImages && req.app.locals.cache) {
        results = await enrichResultsWithCoverImages(results, req.app.locals.cache);
      }

      // Record query for background cache warming (fire-and-forget)
      if (req.app.locals.storage?.searchQueries && query && website !== 'all') {
        req.app.locals.storage.searchQueries
          .upsert(query, website, options.category || '')
          .catch(() => {});
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({
        error: 'Search failed',
        message: error.message,
      });
    }
  },

  // Get available torrent websites
  getTorrentWebsites: (req, res) => {
    res.json(torrentScraperService.getAvailableScrapers());
  },

  // Browse a torrent site by category (no search query)
  browseTorrents: async (req, res) => {

    const category   = req.params.category || '507';
    const page       = req.params.page || 1;
    const sort       = req.query.sort || '3';
    // Allow ?website=hiddenbay; default to piratebay for backward-compat
    const websiteName = (req.query.website || 'piratebay').toLowerCase();

    const options = {
      minSeeders: req.query.minSeeders ? parseInt(req.query.minSeeders) : null,
      maxResults:  req.query.maxResults  ? parseInt(req.query.maxResults)  : null,
    };

    try {
      const scraper = torrentScraperService.getScraper(websiteName);
      if (!scraper || typeof scraper.browse !== 'function') {
        return res.status(400).json({
          error: `Scraper "${websiteName}" does not support browsing`,
        });
      }

      let results = await scraper.browse(category, page, sort, options);
      if (!results) results = [];

      // Add cover images
      if (req.app.locals.cache) {
        results = await enrichResultsWithCoverImages(results, req.app.locals.cache);
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({
        error:   'Browse failed',
        message: error.message,
      });
    }
  },

  // Single torrent search endpoint for specific websites
  searchSingleWebsite: async (req, res) => {

    const { website, query } = req.params;
    const page = req.params.page || 1;

    const websiteLower = website.toLowerCase();

    const options = {
      minSeeders: req.query.minSeeders ? parseInt(req.query.minSeeders) : null,
      maxResults: req.query.maxResults ? parseInt(req.query.maxResults) : null,
      includeCoverImages: req.query.includeCoverImages === 'true' || false,
      sort: req.query.sort || null,
      category: req.query.category || null,
    };

    try {
      let results = await torrentScraperService.searchTorrents(websiteLower, query, page, options);

      // Add cover images to results if requested
      if (options.includeCoverImages && req.app.locals.cache) {
        results = await enrichResultsWithCoverImages(results, req.app.locals.cache);
      }

      // Record query for background cache warming (fire-and-forget)
      if (req.app.locals.storage?.searchQueries) {
        req.app.locals.storage.searchQueries
          .upsert(query, websiteLower, options.category || '')
          .catch(() => {});
      }

      res.json({
        success: true,
        website: websiteLower,
        query: query,
        page: page,
        results: results,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to search torrents',
        message: error.message,
        website: websiteLower,
        query: query,
      });
    }
  },

  // Advanced search with multiple filters
  advancedSearch: async (req, res) => {

    try {
      const {
        query,
        websites = ['all'],
        minSeeders = 0,
        maxResults = 50,
        sortBy = 'seeders',
        sortOrder = 'desc',
        includeCoverImages = false,
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
        // Search all websites
        results = await torrentScraperService.searchAllTorrents(query, 1, searchOptions);
      } else {
        // Search specific websites
        const searchPromises = websites.map(async (website) => {
          const websiteLower = website.toLowerCase();
          try {
            return await torrentScraperService.searchTorrents(websiteLower, query, 1, searchOptions);
          } catch (error) {
            console.error(`Error searching ${website}:`, error);
            return [];
          }
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

      // Add cover images to results if requested
      if (includeCoverImages && req.app.locals.cache) {
        results = await enrichResultsWithCoverImages(results, req.app.locals.cache);
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

// Helper function to enrich search results with cover images
async function enrichResultsWithCoverImages(results, cache) {
  if (!Array.isArray(results) || results.length === 0) {
    return results;
  }

  // Process results in parallel for better performance
  const enrichedResults = await Promise.all(
    results.map(async (torrent) => {
      try {
        const coverImage = await cache.getCoverImageForTorrent(torrent);
        if (coverImage) {
          return {
            ...torrent,
            coverImage: {
              type: coverImage.type,
              url: coverImage.imageUrl || coverImage.originalUrl,
              mimeType: coverImage.mimeType,
            },
          };
        }
      } catch (error) {
        // Silently continue if cover image lookup fails
        console.warn('Failed to get cover image for torrent:', torrent.Name, error.message);
      }
      return torrent;
    })
  );

  return enrichedResults;
}

// Export individual controller functions
module.exports = {
  getTorrentDetails: torrentController.getTorrentDetails,
  searchTorrents: torrentController.searchTorrents,
  getTorrentWebsites: torrentController.getTorrentWebsites,
  searchSingleWebsite: torrentController.searchSingleWebsite,
  advancedSearch: torrentController.advancedSearch,
  browseTorrents: torrentController.browseTorrents,
  enrichResultsWithCoverImages: enrichResultsWithCoverImages,
  router: router,
};
