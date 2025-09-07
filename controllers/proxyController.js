const { createProxyMiddleware } = require('http-proxy-middleware');
const logger = require('../middleware/logger');

/**
 * Real-Debrid API Proxy Controller
 * Handles proxying requests to Real-Debrid API to avoid CORS issues
 */

// Create proxy middleware for Real-Debrid API with explicit configuration
const realDebridProxy = createProxyMiddleware({
  target: 'https://api.real-debrid.com',
  changeOrigin: true,
  secure: true,
  followRedirects: true,
  logLevel: 'debug',
  pathRewrite: {
    '^/api/proxy/real-debrid': '/rest/1.0', // rewrite path
  },
  onProxyReq: (proxyReq, req, res) => {
    logger.info('Proxying request to Real-Debrid', {
      method: req.method,
      originalUrl: req.originalUrl,
      targetUrl: `https://api.real-debrid.com${proxyReq.path}`,
      targetHost: proxyReq.getHeader('host'),
      userAgent: req.get('User-Agent'),
    });

    // Explicitly set the host header to ensure it goes to Real-Debrid
    proxyReq.setHeader('Host', 'api.real-debrid.com');

    // Forward authorization header if present
    if (req.headers.authorization) {
      proxyReq.setHeader('Authorization', req.headers.authorization);
    }

    // Set proper content-type for POST requests
    if (req.method === 'POST' && req.headers['content-type']) {
      proxyReq.setHeader('Content-Type', req.headers['content-type']);
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    logger.info('Received response from Real-Debrid', {
      statusCode: proxyRes.statusCode,
      originalUrl: req.originalUrl,
    });

    // Add CORS headers to the response
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS'
    );
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range'
    );
  },
  onError: (err, req, res) => {
    logger.error('Proxy error for Real-Debrid request', {
      error: err.message,
      originalUrl: req.originalUrl,
      stack: err.stack,
      targetUrl: 'https://api.real-debrid.com',
      headers: req.headers,
    });

    res.status(504).json({
      error: 'Real-Debrid API error',
      message: `504 - Error occurred while trying to proxy to Real-Debrid API (${req.originalUrl} -> https://api.real-debrid.com${req.url.replace('/api/proxy/real-debrid', '/rest/1.0')})`,
      details: err.message,
    });
  },
  // Handle timeout
  timeout: 30000, // 30 seconds
});

// Create proxy middleware for other external APIs that might need proxying
const createGenericProxy = (targetUrl, pathRewrite = {}) => {
  return createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    pathRewrite,
    onProxyReq: (proxyReq, req, res) => {
      logger.info('Proxying generic request', {
        method: req.method,
        originalUrl: req.originalUrl,
        target: targetUrl,
      });

      // Forward common headers
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers['user-agent']) {
        proxyReq.setHeader('User-Agent', req.headers['user-agent']);
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      // Add CORS headers
      res.header('Access-Control-Allow-Origin', '*');
      res.header(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS'
      );
      res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range'
      );
    },
    onError: (err, req, res) => {
      logger.error('Generic proxy error', {
        error: err.message,
        originalUrl: req.originalUrl,
        target: targetUrl,
      });

      res.status(500).json({
        error: 'Proxy Error',
        message: 'Failed to proxy request',
        details: err.message,
      });
    },
    timeout: 30000,
  });
};

// Handle OPTIONS requests for CORS preflight
const handleCorsOptions = (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS'
    );
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range'
    );
    res.status(200).end();
    return;
  }
  next();
};

module.exports = {
  realDebridProxy,
  createGenericProxy,
  handleCorsOptions,
};
