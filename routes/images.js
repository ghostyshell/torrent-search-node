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

  // Batch image processing endpoint
  // Route: POST /api/images/batch-process
  router.post('/batch-process', imageController.batchProcessImages);

  return router;
};

module.exports = setupImageRoutes;
