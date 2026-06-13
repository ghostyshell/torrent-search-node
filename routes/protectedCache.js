const cacheController = require('../controllers/storageController');
const proxyController = require('../controllers/proxyController');

function registerProtectedCacheAndProxyRoutes(app, authMiddleware) {
  const requireAuth = authMiddleware.requireAuth();
  const realDebridProxyChain = [
    requireAuth,
    authMiddleware.getUserRealDebridKey(),
    proxyController.realDebridProxy,
  ];

  app.get('/api/cache/stats', requireAuth, cacheController.getStats);
  app.post('/api/cache/cover-image', requireAuth, cacheController.storeCoverImage);
  app.get('/api/cache/cover-image/:torrentKey', requireAuth, cacheController.getCoverImage);
  app.post(
    '/api/cache/cover-image/torrent',
    requireAuth,
    cacheController.getCoverImageForTorrent
  );
  app.post('/api/cache/stream-url', requireAuth, cacheController.storeStreamUrl);
  app.get('/api/cache/stream-url/:magnetHash', requireAuth, cacheController.getStreamUrl);
  app.post('/api/cache/stream-url/refresh', requireAuth, cacheController.refreshStreamUrl);
  app.post('/api/cache/magnet', requireAuth, cacheController.storeMagnetLink);
  app.get('/api/cache/magnet', requireAuth, cacheController.getMagnetLink);
  app.post('/api/cache/set', requireAuth, cacheController.setCacheValue);
  app.get('/api/cache/get/:key', requireAuth, cacheController.getCacheValue);
  app.delete('/api/cache/delete/:key', requireAuth, cacheController.deleteCacheValue);

  app.post('/api/storage/stream-url', requireAuth, cacheController.storeStreamUrl);
  app.get('/api/storage/stream-url/:magnetHash', requireAuth, cacheController.getStreamUrl);
  app.post('/api/storage/stream-url/refresh', requireAuth, cacheController.refreshStreamUrl);
  app.post('/api/storage/cover-image', requireAuth, cacheController.storeCoverImage);
  app.get('/api/storage/cover-image/:torrentKey', requireAuth, cacheController.getCoverImage);
  app.post(
    '/api/storage/cover-image/torrent',
    requireAuth,
    cacheController.getCoverImageForTorrent
  );
  app.post('/api/storage/set', requireAuth, cacheController.setCacheValue);
  app.get('/api/storage/get/:key', requireAuth, cacheController.getCacheValue);
  app.delete('/api/storage/delete/:key', requireAuth, cacheController.deleteCacheValue);

  app.all('/api/proxy/real-debrid/*', ...realDebridProxyChain);
}

module.exports = registerProtectedCacheAndProxyRoutes;
