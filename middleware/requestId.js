const crypto = require('crypto');

/**
 * Assign a unique request ID for tracing through logs and error responses.
 */
function requestIdMiddleware() {
  return (req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}

module.exports = { requestIdMiddleware };
