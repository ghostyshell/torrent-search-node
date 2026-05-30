/**
 * Dashboard Auth Middleware
 *
 * Gates the monitoring dashboard endpoints behind a shared password
 * (config.security.dashboardPassword / DASHBOARD_PASSWORD).
 *
 * The password may be supplied via:
 *   - X-Dashboard-Password header
 *   - Authorization: Bearer <password>
 *   - dashboard_auth cookie (used by the dashboard UI, which stores it once)
 *
 * When no password is configured the middleware allows access and logs a
 * warning, so the dashboard keeps working (relying on the IP allowlist) until
 * DASHBOARD_PASSWORD is set.
 */

const crypto = require('crypto');
const { config } = require('../config/environment');
const logger = require('./logger');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function getProvidedPassword(req) {
  const headerPw = req.headers['x-dashboard-password'];
  if (headerPw) return headerPw;

  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const entry = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('dashboard_auth='));
    if (entry) {
      try {
        return decodeURIComponent(entry.slice('dashboard_auth='.length));
      } catch {
        return entry.slice('dashboard_auth='.length);
      }
    }
  }

  return null;
}

function dashboardAuth() {
  return (req, res, next) => {
    const expected = config.security.dashboardPassword;

    if (!expected) {
      logger.warn(
        'DASHBOARD_PASSWORD not set — monitoring dashboard endpoints are not password protected'
      );
      return next();
    }

    const provided = getProvidedPassword(req);
    if (provided && safeEqual(provided, expected)) {
      return next();
    }

    return res.status(401).json({
      success: false,
      error: 'Unauthorized: dashboard password required',
      code: 'DASHBOARD_AUTH_REQUIRED',
    });
  };
}

module.exports = dashboardAuth;
