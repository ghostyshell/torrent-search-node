const express = require('express');
const router = express.Router();
const googleImagesService = require('../services/googleImagesService');

// Image controller for all image-related endpoints
const imageController = {
  // Google Images search endpoint
  searchGoogleImages: async (req, res) => {
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
  },

  // Google Images search suggestions endpoint
  getGoogleImagesSuggestions: (req, res) => {
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
  },

  // Batch image processing endpoint
  batchProcessImages: async (req, res) => {
    try {
      const { images, operation = 'validate' } = req.body;

      if (!images || !Array.isArray(images)) {
        return res.status(400).json({
          success: false,
          error: 'Images array is required',
        });
      }

      const results = [];

      for (const imageConfig of images) {
        let result = { originalUrl: imageConfig.url };

        if (operation === 'validate') {
          // Validate the URL and return it for direct client use
          try {
            new URL(imageConfig.url);
            result.url = imageConfig.url;
            result.success = true;
          } catch {
            result.success = false;
            result.error = 'Invalid URL';
          }
        } else {
          result.success = false;
          result.error = 'Unknown operation';
        }

        results.push(result);
      }

      res.json({
        success: true,
        operation: operation,
        totalProcessed: results.length,
        results: results,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Batch image processing failed',
        message: error.message,
      });
    }
  },
};

// Export individual controller functions for direct route binding
module.exports = {
  searchGoogleImages: imageController.searchGoogleImages,
  getGoogleImagesSuggestions: imageController.getGoogleImagesSuggestions,
  batchProcessImages: imageController.batchProcessImages,
  router: router,
};
