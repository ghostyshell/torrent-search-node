const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');

const setupImageRoutes = (storageProvider) => {
  // Google Images search endpoint
  // Route: GET /api/images/google-images/search or /api/google-images/search
  router.get('/google-images/search', imageController.searchGoogleImages);
  router.get('/search', imageController.searchGoogleImages);

  // Google Images suggestions endpoint
  // Route: GET /api/images/google-images/suggestions or /api/google-images/suggestions
  router.get(
    '/google-images/suggestions',
    imageController.getGoogleImagesSuggestions
  );
  router.get('/suggestions', imageController.getGoogleImagesSuggestions);

  // Pixhost upload endpoint
  // Route: POST /api/images/pixhost/upload or /api/pixhost/upload
  router.post('/pixhost/upload', imageController.uploadToPixhost);
  router.post('/upload', imageController.uploadToPixhost);

  // Pixhost accessibility check endpoint
  // Route: GET /api/images/pixhost/check-accessibility
  router.get('/pixhost/check-accessibility', imageController.checkPixhostAccessibility);

  // Pixhost fallback URLs endpoint
  // Route: GET /api/images/pixhost/fallbacks
  router.get('/pixhost/fallbacks', imageController.getPixhostFallbacks);

  // Image proxy endpoint
  // Route: GET /api/images/proxy
  router.get('/proxy', imageController.proxyImage);

  // Legacy route for /api/proxy/image
  router.get('/image', imageController.proxyImage);

  // Batch image processing endpoint
  // Route: POST /api/images/batch-process
  router.post('/batch-process', imageController.batchProcessImages);

  return router;
};

module.exports = setupImageRoutes;
