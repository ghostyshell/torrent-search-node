const AuthService = require('../config/passport');

class AuthMiddleware {
  constructor(cache, authService = null) {
    // Reuse existing authService instance if provided, otherwise create new one
    this.authService = authService || new AuthService(cache);
  }

  requireAuth() {
    return async (req, res, next) => {
      try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '') ||
                           req.cookies?.sessionToken ||
                           req.session?.sessionToken;

        if (!sessionToken) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required',
            code: 'UNAUTHORIZED'
          });
        }

        const userSession = await this.authService.validateSession(sessionToken);
        if (!userSession) {
          return res.status(401).json({
            success: false,
            error: 'Invalid or expired session',
            code: 'INVALID_SESSION'
          });
        }

        req.user = {
          id: userSession.user_id,
          email: userSession.email,
          name: userSession.name,
          picture: userSession.picture,
          sessionId: userSession.id
        };

        req.userId = userSession.user_id;
        next();
      } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
          success: false,
          error: 'Authentication error',
          code: 'AUTH_ERROR'
        });
      }
    };
  }

  optionalAuth() {
    return async (req, res, next) => {
      try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '') ||
                           req.cookies?.sessionToken ||
                           req.session?.sessionToken;

        if (sessionToken) {
          const userSession = await this.authService.validateSession(sessionToken);
          if (userSession) {
            req.user = {
              id: userSession.user_id,
              email: userSession.email,
              name: userSession.name,
              picture: userSession.picture,
              sessionId: userSession.id
            };
            req.userId = userSession.user_id;
          }
        }

        next();
      } catch (error) {
        console.error('Optional auth middleware error:', error);
        next();
      }
    };
  }

  getUserRealDebridKey() {
    return async (req, res, next) => {
      try {
        if (!req.userId) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required for Real Debrid operations',
            code: 'UNAUTHORIZED'
          });
        }

        const apiKey = await this.authService.getRealDebridApiKey(req.userId);
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error: 'Real Debrid API key not configured. Please add it in your account settings.',
            code: 'NO_API_KEY'
          });
        }

        req.realDebridApiKey = apiKey;
        next();
      } catch (error) {
        console.error('Real Debrid key middleware error:', error);
        return res.status(500).json({
          success: false,
          error: 'Error retrieving Real Debrid API key',
          code: 'API_KEY_ERROR'
        });
      }
    };
  }

  restrictToOwner(getResourceUserId) {
    return async (req, res, next) => {
      try {
        const resourceUserId = await getResourceUserId(req);
        if (resourceUserId && resourceUserId !== req.userId) {
          return res.status(403).json({
            success: false,
            error: 'Access denied: You can only access your own data',
            code: 'FORBIDDEN'
          });
        }
        next();
      } catch (error) {
        console.error('Owner restriction middleware error:', error);
        return res.status(500).json({
          success: false,
          error: 'Access control error',
          code: 'ACCESS_CONTROL_ERROR'
        });
      }
    };
  }
}

module.exports = AuthMiddleware;