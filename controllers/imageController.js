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
        // Fetch image from URL with proper headers to avoid blocks
        const response = await fetch(imageUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/*,*/*;q=0.8',
            'Referer': new URL(imageUrl).origin + '/',
          },
        });
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
      // Extract subdomain number from thumbnail URL (e.g., t80.pixhost.to -> 80)
      // Then use img{N}.pixhost.to for the direct URL
      let directImageUrl;
      if (result.th_url) {
        const thMatch = result.th_url.match(/t(\d+)\.pixhost\.to/);
        if (thMatch) {
          const subdomainNum = thMatch[1];
          directImageUrl = result.show_url.replace(
            'https://pixhost.to/show/',
            `https://img${subdomainNum}.pixhost.to/images/`
          );
        } else {
          // Fallback to img1 if we can't extract subdomain
          directImageUrl = result.show_url.replace(
            'https://pixhost.to/show/',
            'https://img1.pixhost.to/images/'
          );
        }
      } else {
        // Fallback if no thumbnail URL
        directImageUrl = result.show_url.replace(
          'https://pixhost.to/show/',
          'https://img1.pixhost.to/images/'
        );
      }

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
      const fetch = require('node-fetch');

      for (const imageConfig of images) {
        try {
          let result = { originalUrl: imageConfig.url };

          switch (operation) {
            case 'validate':
              // Validate the URL and return it for direct client use
              try {
                new URL(imageConfig.url);
                result.url = imageConfig.url;
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

  // Get Pixhost fallback URLs (includes backup host URLs from database)
  getPixhostFallbacks: async (req, res) => {
    const imageUrl = req.query.url;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'URL parameter is required',
      });
    }

    try {
      const parsedUrl = new URL(imageUrl);

      // Check if it's a Pixhost URL
      if (!parsedUrl.hostname.includes('pixhost.to')) {
        return res.json({
          success: true,
          fallbacks: [],
          isPixhost: false,
        });
      }

      // Try to find stored fallback URLs from database (includes backup hosts)
      const storage = req.app.locals.cache;
      if (storage && storage.images) {
        // Look up by pixhost URL to find stored backup host fallbacks
        const storedImage = await storage.images.getByPixhostUrl(imageUrl);
        if (storedImage && storedImage.fallbackUrls && storedImage.fallbackUrls.length > 0) {
          return res.json({
            success: true,
            fallbacks: storedImage.fallbackUrls,
            isPixhost: true,
            hasBackupHosts: true,
          });
        }
      }

      // No stored fallbacks, generate pixhost subdomain fallbacks
      let imagePath = '';
      const pixhostSubdomains = [
        'img1.pixhost.to',
        'img2.pixhost.to',
        'img3.pixhost.to',
        'img4.pixhost.to',
        'img5.pixhost.to',
      ];

      for (const subdomain of pixhostSubdomains) {
        const prefix = `https://${subdomain}/images/`;
        if (imageUrl.startsWith(prefix)) {
          imagePath = imageUrl.substring(prefix.length);
          break;
        }
      }

      // Handle show URL format
      if (!imagePath && imageUrl.startsWith('https://pixhost.to/show/')) {
        imagePath = imageUrl.substring('https://pixhost.to/show/'.length);
      }

      if (!imagePath) {
        return res.json({
          success: true,
          fallbacks: [imageUrl],
          isPixhost: true,
        });
      }

      // Generate fallback URLs for all subdomains
      const fallbacks = pixhostSubdomains.map(
        (subdomain) => `https://${subdomain}/images/${imagePath}`
      );

      res.json({
        success: true,
        fallbacks,
        isPixhost: true,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: 'Invalid URL format',
      });
    }
  },

  // Private helper method for single image upload
  _uploadSingleImageToPixhost: async (imageUrl) => {
    const fetch = require('node-fetch');
    const FormData = require('form-data');

    // Fetch with proper headers to avoid blocks from image hosts
    const response = await fetch(imageUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/*,*/*;q=0.8',
        'Referer': new URL(imageUrl).origin + '/',
      },
    });
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

    // Extract subdomain number from thumbnail URL for correct direct URL
    let directImageUrl;
    if (result.th_url) {
      const thMatch = result.th_url.match(/t(\d+)\.pixhost\.to/);
      if (thMatch) {
        const subdomainNum = thMatch[1];
        directImageUrl = result.show_url.replace(
          'https://pixhost.to/show/',
          `https://img${subdomainNum}.pixhost.to/images/`
        );
      } else {
        directImageUrl = result.show_url.replace(
          'https://pixhost.to/show/',
          'https://img1.pixhost.to/images/'
        );
      }
    } else {
      directImageUrl = result.show_url.replace(
        'https://pixhost.to/show/',
        'https://img1.pixhost.to/images/'
      );
    }

    return {
      pixhostUrl: directImageUrl,
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
  batchProcessImages: imageController.batchProcessImages,
  getPixhostFallbacks: imageController.getPixhostFallbacks,
  router: router,
};
