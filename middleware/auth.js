const AuthService = require('../config/passport');

class AuthMiddleware {
  constructor(cache, authService = null) {
    // Reuse existing authService instance if provided, otherwise create new one
    this.authService = authService || new AuthService(cache);
  }

  requireAuth() {
    return async (req, res, next) => {
      try {
        const sessionToken =
          req.headers.authorization?.replace('Bearer ', '') ||
          req.cookies?.sessionToken ||
          req.session?.sessionToken;

        if (!sessionToken) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required',
            code: 'UNAUTHORIZED',
          });
        }

        // First try database session validation
        const userSession = await this.authService.validateSession(
          sessionToken
        );
        if (userSession) {
          req.user = {
            id: userSession.user_id,
            email: userSession.email,
            name: userSession.name,
            picture: userSession.picture,
            sessionId: userSession.id,
          };
          req.userId = userSession.user_id;
          next();
          return;
        }

        // Fallback: Try to validate as base64 temporary token
        try {
          const tokenData = JSON.parse(
            Buffer.from(sessionToken, 'base64').toString()
          );

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
          console.log('🔍 [Auth] Token data:', {
            id: tokenData.id,
            email: tokenData.email,
            name: tokenData.name,
          });

          // Create or get user from database using token data
          const userData = {
            id: tokenData.id,
            google_id: tokenData.id,
            email: tokenData.email,
            name: tokenData.name || 'Unknown User',
            picture: tokenData.picture || null,
            last_login_at: Math.floor(Date.now() / 1000),
          };

          // Try to find or create user in database
          console.log('🔍 [Auth] Looking up user by email:', tokenData.email);
          let user = await this.authService.getUserByEmail(tokenData.email);
          console.log(
            '🔍 [Auth] Found existing user:',
            !!user,
            user ? { id: user.id, email: user.email } : 'null'
          );

          if (!user) {
            // Create new user
            console.log('🔍 [Auth] Creating new user with data:', userData);
            const newUser = await this.authService.findOrCreateUser(userData);
            console.log(
              '🔍 [Auth] Created new user:',
              !!newUser,
              newUser ? { id: newUser.id, email: newUser.email } : 'null'
            );
            user = newUser;
          }

          if (user) {
            console.log('🔍 [Auth] Setting req.userId to:', user.id);
            req.user = {
              id: user.id,
              email: user.email,
              name: user.name,
              picture: user.picture,
              sessionId: null, // No session ID for temporary tokens
            };
            req.userId = user.id;
          } else {
            console.log(
              '❌ [Auth] No user found or created, req.userId will be null'
            );
            req.userId = null;
          }

          console.log('🔍 [Auth] Final req.userId:', req.userId);
          next();
          return;
        } catch (tokenError) {
          console.warn(
            'Both session and token validation failed:',
            tokenError.message
          );
        }

        return res.status(401).json({
          success: false,
          error: 'Invalid or expired session',
          code: 'INVALID_SESSION',
        });
      } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
          success: false,
          error: 'Authentication error',
          code: 'AUTH_ERROR',
        });
      }
    };
  }

  optionalAuth() {
    return async (req, res, next) => {
      try {
        console.log('🔍 [OptionalAuth] Starting optional auth middleware');
        const sessionToken =
          req.headers.authorization?.replace('Bearer ', '') ||
          req.cookies?.sessionToken ||
          req.session?.sessionToken;

        console.log('🔍 [OptionalAuth] Session token present:', !!sessionToken);

        if (sessionToken) {
          // First try database session validation
          console.log(
            '🔍 [OptionalAuth] Trying database session validation...'
          );
          const userSession = await this.authService.validateSession(
            sessionToken
          );
          if (userSession) {
            console.log(
              '🔍 [OptionalAuth] Database session valid, setting user'
            );
            req.user = {
              id: userSession.user_id,
              email: userSession.email,
              name: userSession.name,
              picture: userSession.picture,
              sessionId: userSession.id,
            };
            req.userId = userSession.user_id;
            console.log(
              '🔍 [OptionalAuth] Set req.userId from database session:',
              req.userId
            );
            next();
            return;
          }

          // Fallback: Try to validate as base64 temporary token
          console.log(
            '🔍 [OptionalAuth] Database session invalid, trying temporary token...'
          );
          try {
            const tokenData = JSON.parse(
              Buffer.from(sessionToken, 'base64').toString()
            );

            // Basic validation - check if token has required fields and isn't too old
            if (!tokenData.id || !tokenData.email || !tokenData.timestamp) {
              throw new Error('Invalid token format');
            }

            // Check if token is not older than 24 hours
            const tokenAge = Date.now() - tokenData.timestamp;
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours
            if (tokenAge > maxAge) {
              throw new Error('Token expired');
            }

            console.log('Using temporary token for user:', tokenData.email);
            console.log('🔍 [Auth] Token data:', {
              id: tokenData.id,
              email: tokenData.email,
              name: tokenData.name,
            });

            // Create or get user from database using token data
            const userData = {
              google_id: tokenData.id,
              email: tokenData.email,
              name: tokenData.name,
              picture: tokenData.picture,
            };

            console.log('🔍 [Auth] Looking up user by email:', tokenData.email);
            let user = await this.authService.getUserByEmail(tokenData.email);
            console.log(
              '🔍 [Auth] Found existing user:',
              !!user,
              user ? { id: user.id, email: user.email } : 'null'
            );

            if (!user) {
              // Create new user
              console.log('🔍 [Auth] Creating new user with data:', userData);
              const newUser = await this.authService.findOrCreateUser(userData);
              console.log(
                '🔍 [Auth] Created new user:',
                !!newUser,
                newUser ? { id: newUser.id, email: newUser.email } : 'null'
              );
              user = newUser;
            }

            if (user) {
              req.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                picture: user.picture,
              };
              console.log('🔍 [Auth] Setting req.userId to:', user.id);
              req.userId = user.id;
            } else {
              console.log(
                '❌ [Auth] No user found or created, req.userId will be null'
              );
              req.userId = null;
            }

            console.log('🔍 [Auth] Final req.userId:', req.userId);
          } catch (tempTokenError) {
            console.log(
              '🔍 [OptionalAuth] Temporary token validation failed:',
              tempTokenError.message
            );
            // For optional auth, we continue without setting user
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
            code: 'UNAUTHORIZED',
          });
        }

        const apiKey = await this.authService.getRealDebridApiKey(req.userId);
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error:
              'Real Debrid API key not configured. Please add it in your account settings.',
            code: 'NO_API_KEY',
          });
        }

        req.realDebridApiKey = apiKey;
        next();
      } catch (error) {
        console.error('Real Debrid key middleware error:', error);
        return res.status(500).json({
          success: false,
          error: 'Error retrieving Real Debrid API key',
          code: 'API_KEY_ERROR',
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
            code: 'FORBIDDEN',
          });
        }
        next();
      } catch (error) {
        console.error('Owner restriction middleware error:', error);
        return res.status(500).json({
          success: false,
          error: 'Access control error',
          code: 'ACCESS_CONTROL_ERROR',
        });
      }
    };
  }
}

module.exports = AuthMiddleware;
