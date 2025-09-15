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

        // First try database session validation
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
          next();
          return;
        }

        // Fallback: Try to validate as base64 temporary token
        try {
          const tokenData = JSON.parse(Buffer.from(sessionToken, 'base64').toString());

          // Basic validation - check if token has required fields and isn't too old
          if (!tokenData.id || !tokenData.email || !tokenData.timestamp) {
            throw new Error('Invalid token format');
          }

          // Check if token is less than 24 hours old
          const tokenAge = Date.now() - tokenData.timestamp;
          const maxAge = 24 * 60 * 60 * 1000; // 24 hours

          if (tokenAge > maxAge) {
            throw new Error('Token expired');
          }

          console.log('Using temporary token for user:', tokenData.email);

          // Create or get user from database using token data
          const userData = {
            id: tokenData.id,
            google_id: tokenData.id,
            email: tokenData.email,
            name: tokenData.name || 'Unknown User',
            picture: tokenData.picture || null,
            last_login_at: Math.floor(Date.now() / 1000)
          };

          // Try to find or create user in database
          let user = await this.authService.getUserByEmail(tokenData.email);
          if (!user) {
            // Create new user
            const newUser = await this.authService.findOrCreateUser(userData);
            user = newUser;
          }

          req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture,
            sessionId: null // No session ID for temporary tokens
          };
          req.userId = user.id;
          next();
          return;
        } catch (tokenError) {
          console.warn('Both session and token validation failed:', tokenError.message);
        }

        return res.status(401).json({
          success: false,
          error: 'Invalid or expired session',
          code: 'INVALID_SESSION'
        });
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