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

  // Pixhost accessibility check endpoint
  checkPixhostAccessibility: async (req, res) => {
    const fetch = require('node-fetch');

    // Pixhost subdomains to test
    const pixhostSubdomains = [
      'img1.pixhost.to',
      'img2.pixhost.to',
      'img3.pixhost.to',
      'img4.pixhost.to',
      'img5.pixhost.to',
    ];

    // Fallback hosts (same as Go version)
    const fallbackHosts = ['postimage', 'fastpic'];

    const testResults = {};
    let accessible = false;

    // Test each Pixhost subdomain
    await Promise.all(
      pixhostSubdomains.map(async (subdomain) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(`https://${subdomain}/`, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });

          clearTimeout(timeoutId);

          if (response.status < 400) {
            testResults[subdomain] = true;
            accessible = true;
          } else {
            testResults[subdomain] = false;
          }
        } catch (error) {
          testResults[subdomain] = false;
          console.debug('Pixhost subdomain unreachable:', subdomain, error.message);
        }
      })
    );

    // Get recommendation
    const recommendation = accessible
      ? {
          usePixhost: true,
          primaryHost: pixhostSubdomains.find((s) => testResults[s]) || 'img1.pixhost.to',
          fallbackHosts,
        }
      : {
          usePixhost: false,
          fallbackHosts,
        };

    res.json({
      success: true,
      pixhostAccessible: accessible,
      subdomainStatus: testResults,
      recommendation,
    });
  },

  // Get Pixhost fallback URLs
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

      // Extract the image path
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
  proxyImage: imageController.proxyImage,
  batchProcessImages: imageController.batchProcessImages,
  router: router,
};
