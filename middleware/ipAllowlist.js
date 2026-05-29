/**
 * IP Allowlist Middleware
 * Restricts access to monitoring/debug endpoints based on IP address
 */

const { config } = require('../config/environment');
const logger = require('./logger');

class IpAllowlistMiddleware {
  constructor() {
    this.allowlist = config.security.monitoringIpAllowlist || [];
  }

  /**
   * Middleware that restricts access to allowed IPs
   * If allowlist is empty, access is allowed (relies on other auth)
   */
  restrictToAllowlist() {
    return (req, res, next) => {
      // If no allowlist configured, allow access (other auth middleware should protect)
      if (!this.allowlist || this.allowlist.length === 0) {
        next();
        return;
      }

      const clientIp = this.getClientIp(req);

      if (!this.isIpAllowed(clientIp)) {
        logger.warn('IP allowlist check failed', {
          clientIp,
          allowlist: this.allowlist,
          path: req.path,
        });

        return res.status(403).json({
          success: false,
          error: 'Access denied: IP address not allowed',
          code: 'IP_NOT_ALLOWED',
        });
      }

      next();
    };
  }

  /**
   * Get client IP from request, considering proxy headers
   */
  getClientIp(req) {
    // Check X-Forwarded-For header (when behind proxy/load balancer)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      // X-Forwarded-For can contain multiple IPs: client, proxy1, proxy2, ...
      // The first one is the original client
      const ips = forwardedFor.split(',').map((ip) => ip.trim());
      if (ips[0]) {
        return ips[0];
      }
    }

    // Check X-Real-IP header (common single-IP header)
    const realIp = req.headers['x-real-ip'];
    if (realIp) {
      return realIp.trim();
    }

    // Fall back to direct connection IP
    return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  }

  /**
   * Check if IP is in allowlist
   * Supports exact matches and CIDR notation
   */
  isIpAllowed(ip) {
    if (!ip || ip === 'unknown') {
      return false;
    }

    for (const allowed of this.allowlist) {
      if (this.ipMatches(ip, allowed)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if IP matches allowed entry (supports exact IP or CIDR)
   */
  ipMatches(ip, allowed) {
    // Exact match
    if (ip === allowed) {
      return true;
    }

    // CIDR notation match (e.g., 192.168.1.0/24)
    if (allowed.includes('/')) {
      return this.ipInCidr(ip, allowed);
    }

    return false;
  }

  /**
   * Check if IP is within CIDR range
   */
  ipInCidr(ip, cidr) {
    try {
      const [network, prefixLength] = cidr.split('/');
      const prefix = parseInt(prefixLength, 10);

      if (isNaN(prefix) || prefix < 0 || prefix > 32) {
        return false;
      }

      const ipNum = this.ipToNumber(ip);
      const networkNum = this.ipToNumber(network);
      const mask = (0xffffffff << (32 - prefix)) & 0xffffffff;

      return (ipNum & mask) === (networkNum & mask);
    } catch (error) {
      logger.error('CIDR check failed', { ip, cidr, error: error.message });
      return false;
    }
  }

  /**
   * Convert IP address to 32-bit number
   */
  ipToNumber(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) {
      return 0;
    }

    let num = 0;
    for (let i = 0; i < 4; i++) {
      const octet = parseInt(parts[i], 10);
      if (isNaN(octet) || octet < 0 || octet > 255) {
        return 0;
      }
      num = (num << 8) | octet;
    }

    return num >>> 0; // Convert to unsigned 32-bit
  }

  /**
   * Update allowlist dynamically (useful for testing)
   */
  setAllowlist(allowlist) {
    this.allowlist = allowlist;
  }
}

module.exports = IpAllowlistMiddleware;
