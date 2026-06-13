const logger = require('../middleware/logger');
const fetch = require('node-fetch');

/**
 * Real-Debrid API Proxy Controller
 * Custom implementation to handle Real-Debrid API calls directly
 */

// Custom Real-Debrid proxy handler
const realDebridProxy = async (req, res) => {
  try {
    const realDebridPath = req.originalUrl.replace('/api/proxy/real-debrid', '');
    const targetUrl = `https://api.real-debrid.com/rest/1.0${realDebridPath}`;

    logger.info('Proxying request to Real-Debrid', {
      method: req.method,
      originalUrl: req.originalUrl,
      targetUrl,
      userId: req.userId,
    });

    const headers = {
      'Content-Type':
        req.headers['content-type'] || 'application/x-www-form-urlencoded',
      'User-Agent': req.headers['user-agent'] || 'torrent-search-node/1.0',
      Authorization: `Bearer ${req.realDebridApiKey}`,
    };

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
      bodyLength: fetchOptions.body ? fetchOptions.body.length : 0,
      userId: req.userId,
    });

    // Make the request to Real-Debrid
    const response = await fetch(targetUrl, fetchOptions);

    logger.info('Received response from Real-Debrid', {
      statusCode: response.status,
      statusText: response.statusText,
      originalUrl: req.originalUrl,
    });

    // Set response status
    res.status(response.status);

    // Handle the response
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    
    // Handle empty responses (like 204 No Content or empty body)
    if (contentLength === '0' || response.status === 204) {
      res.status(response.status).json({});
      return;
    }

    // Try to get response body
    const responseText = await response.text();
    
    // Handle empty response body
    if (!responseText || responseText.trim() === '') {
      res.status(response.status).json({});
      return;
    }

    // Try to parse as JSON if content type suggests it or if it looks like JSON
    if (contentType && contentType.includes('application/json')) {
      try {
        const jsonData = JSON.parse(responseText);
        res.json(jsonData);
      } catch (parseError) {
        // If JSON parsing fails, return as text
        logger.warn('Failed to parse JSON response from Real-Debrid', {
          originalUrl: req.originalUrl,
          responseText: responseText.substring(0, 200),
          contentType,
          parseError: parseError.message,
        });
        res.send(responseText);
      }
    } else {
      // Return as text for non-JSON responses
      res.send(responseText);
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
    onProxyRes: () => {},
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

module.exports = {
  realDebridProxy,
  createGenericProxy,
};
