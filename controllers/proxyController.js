const logger = require('../middleware/logger');
const fetch = require('node-fetch');

/**
 * Real-Debrid API Proxy Controller
 * Custom implementation to handle Real-Debrid API calls directly
 */

// Custom Real-Debrid proxy handler
const realDebridProxy = async (req, res) => {
  try {
    // Extract the path after /api/proxy/real-debrid
    const realDebridPath = req.originalUrl.replace('/api/proxy/real-debrid', '');
    const targetUrl = `https://api.real-debrid.com/rest/1.0${realDebridPath}`;

    logger.info('Proxying request to Real-Debrid', {
      method: req.method,
      originalUrl: req.originalUrl,
      targetUrl: targetUrl,
      headers: req.headers,
    });

    // Prepare headers
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
      'User-Agent': req.headers['user-agent'] || 'TorrentSearch-Proxy/1.0',
    };

    // Forward authorization header
    if (req.headers.authorization) {
      headers.Authorization = req.headers.authorization;
    }

    // Prepare request options
    const fetchOptions = {
      method: req.method,
      headers: headers,
      timeout: 30000, // 30 seconds
    };

    // Handle POST body
    if (req.method === 'POST' && req.body) {
      if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
        // Convert body object to URL-encoded string
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(req.body)) {
          params.append(key, value);
        }
        fetchOptions.body = params.toString();
      } else {
        fetchOptions.body = JSON.stringify(req.body);
      }
    }

    logger.info('Making request to Real-Debrid', {
      targetUrl,
      method: req.method,
      headers: headers,
      bodyLength: fetchOptions.body ? fetchOptions.body.length : 0,
    });

    // Make the request to Real-Debrid
    const response = await fetch(targetUrl, fetchOptions);

    logger.info('Received response from Real-Debrid', {
      statusCode: response.status,
      statusText: response.statusText,
      originalUrl: req.originalUrl,
    });

    // Set CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');

    // Set response status
    res.status(response.status);

    // Handle the response
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const jsonData = await response.json();
      res.json(jsonData);
    } else {
      const textData = await response.text();
      res.send(textData);
    }

  } catch (error) {
    logger.error('Real-Debrid proxy error', {
      error: error.message,
      originalUrl: req.originalUrl,
      stack: error.stack,
    });

    res.status(504).json({
      error: 'Real-Debrid API error',
      message: `Error occurred while trying to proxy: ${req.get('host')}${req.originalUrl.replace('/api/proxy/real-debrid', '')}`,
      details: error.message,
    });
  }
};

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
