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

  // Pixhost image upload proxy endpoint
  uploadToPixhost: async (req, res) => {
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
      form.append('content_type', '1'); // 1 for adult content (prevents removal)
      form.append('max_th_size', '420');

      // Upload to pixhost
      const pixhostResponse = await fetch('https://api.pixhost.to/images', {
        method: 'POST',
        body: form,
        headers: {
          Accept: 'application/json',
          ...form.getHeaders(),
        },
      });

      if (!pixhostResponse.ok) {
        const errorText = await pixhostResponse.text();
        throw new Error(
          `Pixhost API error: ${pixhostResponse.status} ${errorText}`
        );
      }

      const result = await pixhostResponse.json();

      if (!result.show_url) {
        throw new Error('Invalid response from pixhost API');
      }

      // Convert show URL to direct image URL
      // https://pixhost.to/show/8325/636090636_image.jpg -> https://img1.pixhost.to/images/8325/636090636_image.jpg
      const directImageUrl = result.show_url.replace(
        'https://pixhost.to/show/',
        'https://img1.pixhost.to/images/'
      );

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
  },

  // Image proxy endpoint for bypassing CORS
  proxyImage: async (req, res) => {
    try {
      const { url } = req.query;

      if (!url) {
        return res.status(400).json({
          success: false,
          error: 'Image URL is required',
        });
      }

      const fetch = require('node-fetch');

      // Validate URL
      let imageUrl;
      try {
        imageUrl = new URL(url);
      } catch {
        return res.status(400).json({
          success: false,
          error: 'Invalid URL provided',
        });
      }

      // Fetch the image
      const response = await fetch(imageUrl.href, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          Accept: 'image/*',
        },
        timeout: 10000, // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch image: ${response.status} ${response.statusText}`
        );
      }

      const contentType = response.headers.get('content-type');

      // Verify it's an image
      if (!contentType || !contentType.startsWith('image/')) {
        return res.status(400).json({
          success: false,
          error: 'URL does not point to a valid image',
        });
      }

      // Set appropriate headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Stream the image
      response.body.pipe(res);
    } catch (error) {
      console.error('Image proxy error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to proxy image',
        message: error.message,
      });
    }
  },

  // Batch image processing endpoint
  batchProcessImages: async (req, res) => {
    try {
      const { images, operation = 'proxy' } = req.body;

      if (!images || !Array.isArray(images)) {
        return res.status(400).json({
          success: false,
          error: 'Images array is required',
        });
      }

      const results = [];
      const fetch = require('node-fetch');

      for (const imageConfig of images) {
        try {
          let result = { originalUrl: imageConfig.url };

          switch (operation) {
            case 'proxy':
              // Just validate the URL for proxy operation
              try {
                new URL(imageConfig.url);
                result.proxyUrl = `/api/images/proxy?url=${encodeURIComponent(
                  imageConfig.url
                )}`;
                result.success = true;
              } catch {
                result.success = false;
                result.error = 'Invalid URL';
              }
              break;

            case 'upload':
              // Upload to pixhost
              try {
                const uploadResult =
                  await imageController._uploadSingleImageToPixhost(
                    imageConfig.url
                  );
                result = { ...result, ...uploadResult, success: true };
              } catch (error) {
                result.success = false;
                result.error = error.message;
              }
              break;

            default:
              result.success = false;
              result.error = 'Unknown operation';
          }

          results.push(result);
        } catch (error) {
          results.push({
            originalUrl: imageConfig.url,
            success: false,
            error: error.message,
          });
        }
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

  // Private helper method for single image upload
  _uploadSingleImageToPixhost: async (imageUrl) => {
    const fetch = require('node-fetch');
    const FormData = require('form-data');

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const imageBuffer = await response.buffer();

    const form = new FormData();
    form.append('img', imageBuffer, {
      filename: 'image.jpg',
      contentType: 'image/jpeg',
    });
    form.append('content_type', '1'); // 1 for adult content (prevents removal)
    form.append('max_th_size', '420');

    const pixhostResponse = await fetch('https://api.pixhost.to/images', {
      method: 'POST',
      body: form,
      headers: {
        Accept: 'application/json',
        ...form.getHeaders(),
      },
    });

    if (!pixhostResponse.ok) {
      const errorText = await pixhostResponse.text();
      throw new Error(
        `Pixhost API error: ${pixhostResponse.status} ${errorText}`
      );
    }

    const result = await pixhostResponse.json();

    if (!result.show_url) {
      throw new Error('Invalid response from pixhost API');
    }

    return {
      pixhostUrl: result.show_url.replace(
        'https://pixhost.to/show/',
        'https://img1.pixhost.to/images/'
      ),
      pixhostShowUrl: result.show_url,
      thumbnailUrl: result.th_url,
    };
  },
};

// Export individual controller functions for direct route binding
module.exports = {
  searchGoogleImages: imageController.searchGoogleImages,
  getGoogleImagesSuggestions: imageController.getGoogleImagesSuggestions,
  uploadToPixhost: imageController.uploadToPixhost,
  proxyImage: imageController.proxyImage,
  batchProcessImages: imageController.batchProcessImages,
  router: router,
};
