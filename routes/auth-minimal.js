const express = require('express');
const router = express.Router();

const setupMinimalAuthRoutes = (cache) => {
  console.log('setupMinimalAuthRoutes called with cache:', !!cache);

  // Simple routes without passport
  router.get('/google', (req, res) => {
    res.json({
      message: 'Google auth route (minimal)',
      redirect: 'https://accounts.google.com/oauth/authorize'
    });
  });

  router.get('/google/callback', (req, res) => {
    res.json({ message: 'Google callback (minimal)' });
  });

  router.get('/user', (req, res) => {
    res.json({ message: 'User endpoint (minimal)' });
  });

  console.log('setupMinimalAuthRoutes completed, returning router');
  return router;
};

module.exports = setupMinimalAuthRoutes;