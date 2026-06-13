const express = require('express');
const passport = require('passport');
const router = express.Router();
const AuthService = require('../config/passport');
const AuthMiddleware = require('../middleware/auth');
const { setSessionCookie, clearSessionCookie } = require('../utils/sessionCookie');

const setupAuthRoutes = (cache) => {
  const authService = new AuthService(cache);
  const authMiddleware = new AuthMiddleware(cache, authService);

  router.get(
    '/google',
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      prompt: 'select_account',
    })
  );

  router.get(
    '/google/callback',
    passport.authenticate('google', {
      failureRedirect: process.env.FRONTEND_URL + '/login?error=auth_failed',
      session: false,
    }),
    async (req, res) => {
      try {
        const allowedEmails =
          process.env.ALLOWED_EMAILS?.split(',').map((e) => e.trim().toLowerCase()) ||
          [];
        const userEmail = req.user.email.toLowerCase();

        if (allowedEmails.length > 0 && !allowedEmails.includes(userEmail)) {
          return res.redirect(process.env.FRONTEND_URL + '/login?email_not_allowed=1');
        }

        const user = await authService.findOrCreateUser({
          google_id: req.user.google_id || req.user.id,
          email: req.user.email,
          name: req.user.name,
          picture: req.user.picture,
          last_login_at: Math.floor(Date.now() / 1000),
        });

        const session = await authService.createSession(user.id, {
          userAgent: req.get('user-agent'),
          ipAddress: req.ip,
        });

        setSessionCookie(res, session.token);

        const exchangeCode = await authService.createExchangeCode(session.token);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const redirectUrl = new URL(frontendUrl);
        redirectUrl.searchParams.set('auth_exchange', exchangeCode);
        res.redirect(redirectUrl.toString());
      } catch (error) {
        console.error('Google callback error:', error);
        res.redirect(process.env.FRONTEND_URL + '/login?error=callback_failed');
      }
    }
  );

  router.post('/logout', authMiddleware.requireAuth(), async (req, res) => {
    try {
      const sessionToken =
        req.headers.authorization?.replace('Bearer ', '') ||
        req.cookies?.sessionToken;

      if (sessionToken) {
        await authService.deleteSession(sessionToken);
      }

      clearSessionCookie(res);

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        error: 'Logout failed',
        code: 'LOGOUT_ERROR',
      });
    }
  });

  router.get('/user', authMiddleware.requireAuth(), async (req, res) => {
    try {
      const user = await authService.getUserById(req.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
        });
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
          hasRealDebridKey: !!user.real_debrid_api_key,
          createdAt: user.created_at,
          lastLoginAt: user.last_login_at,
        },
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching user data',
        code: 'USER_FETCH_ERROR',
      });
    }
  });

  router.get(
    '/realdebrid/api-key',
    authMiddleware.requireAuth(),
    async (req, res) => {
      try {
        const user = await authService.getUserById(req.userId);
        if (!user) {
          return res.status(404).json({
            success: false,
            error: 'User not found',
            code: 'USER_NOT_FOUND',
          });
        }

        res.json({
          success: true,
          hasApiKey: !!user.real_debrid_api_key,
        });
      } catch (error) {
        console.error('Get Real Debrid API key error:', error);
        res.status(500).json({
          success: false,
          error: 'Error fetching API key status',
          code: 'FETCH_ERROR',
        });
      }
    }
  );

  router.post(
    '/realdebrid/api-key',
    authMiddleware.requireAuth(),
    async (req, res) => {
      try {
        const { apiKey } = req.body;

        if (!apiKey || typeof apiKey !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'Valid API key is required',
            code: 'INVALID_API_KEY',
          });
        }

        const success = await authService.setRealDebridApiKey(req.userId, apiKey);

        if (!success) {
          return res.status(500).json({
            success: false,
            error: 'Failed to save API key',
            code: 'SAVE_ERROR',
          });
        }

        res.json({
          success: true,
          message: 'Real Debrid API key saved successfully',
        });
      } catch (error) {
        console.error('Save Real Debrid API key error:', error);
        res.status(500).json({
          success: false,
          error: 'Error saving API key',
          code: 'SAVE_ERROR',
        });
      }
    }
  );

  router.delete(
    '/realdebrid/api-key',
    authMiddleware.requireAuth(),
    async (req, res) => {
      try {
        const success = await authService.setRealDebridApiKey(req.userId, null);

        if (!success) {
          return res.status(500).json({
            success: false,
            error: 'Failed to remove API key',
            code: 'REMOVE_ERROR',
          });
        }

        res.json({
          success: true,
          message: 'Real Debrid API key removed successfully',
        });
      } catch (error) {
        console.error('Remove Real Debrid API key error:', error);
        res.status(500).json({
          success: false,
          error: 'Error removing API key',
          code: 'REMOVE_ERROR',
        });
      }
    }
  );

  router.post('/exchange', async (req, res) => {
    try {
      const { code } = req.body;

      if (!code || typeof code !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Exchange code is required',
          code: 'MISSING_CODE',
        });
      }

      const sessionToken = await authService.consumeExchangeCode(code);
      if (!sessionToken) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired exchange code',
          code: 'INVALID_CODE',
        });
      }

      const userSession = await authService.validateSession(sessionToken);
      if (!userSession) {
        return res.status(401).json({
          success: false,
          error: 'Session could not be established',
          code: 'SESSION_ERROR',
        });
      }

      const allowedEmails =
        process.env.ALLOWED_EMAILS?.split(',').map((e) => e.trim().toLowerCase()) ||
        [];
      const isEmailAllowed =
        allowedEmails.length === 0 ||
        allowedEmails.includes(userSession.email.toLowerCase());

      if (!isEmailAllowed) {
        return res.status(403).json({
          success: false,
          error: 'Email not authorized',
          code: 'EMAIL_NOT_ALLOWED',
        });
      }

      setSessionCookie(res, sessionToken);

      res.json({
        success: true,
        token: sessionToken,
        user: {
          id: userSession.user_id,
          email: userSession.email,
          name: userSession.name,
          picture: userSession.picture,
          hasRealDebridKey: !!userSession.real_debrid_api_key,
          createdAt: userSession.created_at,
          lastLoginAt: userSession.last_login_at,
          isEmailAllowed,
        },
      });
    } catch (error) {
      console.error('Auth exchange error:', error);
      res.status(500).json({
        success: false,
        error: 'Auth exchange failed',
        code: 'EXCHANGE_ERROR',
      });
    }
  });

  router.post('/validate', async (req, res) => {
    try {
      const token =
        req.body?.token ||
        req.cookies?.sessionToken ||
        req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          code: 'MISSING_TOKEN',
        });
      }

      const allowedEmails =
        process.env.ALLOWED_EMAILS?.split(',').map((e) => e.trim().toLowerCase()) ||
        [];

      const userSession = await authService.validateSession(token);
      if (!userSession) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired session',
          code: 'INVALID_TOKEN',
        });
      }

      const isEmailAllowed =
        allowedEmails.length === 0 ||
        allowedEmails.includes(userSession.email.toLowerCase());

      res.json({
        success: true,
        user: {
          id: userSession.user_id,
          email: userSession.email,
          name: userSession.name,
          picture: userSession.picture,
          hasRealDebridKey: !!userSession.real_debrid_api_key,
          createdAt: userSession.created_at,
          lastLoginAt: userSession.last_login_at,
          isEmailAllowed,
        },
      });
    } catch (error) {
      console.error('Token validation endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'Token validation failed',
        code: 'VALIDATION_ERROR',
      });
    }
  });

  router.get('/sessions', authMiddleware.requireAuth(), async (req, res) => {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      const sessions = await cache.authStore.sessions()
        .find({ user_id: req.userId, expires_at: { $gt: currentTime } })
        .sort({ last_accessed_at: -1 })
        .project({
          _id: 0,
          id: 1,
          session_token: 1,
          created_at: 1,
          last_accessed_at: 1,
          user_agent: 1,
          ip_address: 1,
        })
        .toArray();

      const currentToken =
        req.headers.authorization?.replace('Bearer ', '') || req.cookies?.sessionToken;

      res.json({
        success: true,
        sessions: sessions.map((session) => ({
          id: session.id,
          isCurrentSession: session.session_token === currentToken,
          createdAt: session.created_at,
          lastAccessedAt: session.last_accessed_at,
          userAgent: session.user_agent,
          ipAddress: session.ip_address,
        })),
      });
    } catch (error) {
      console.error('Get sessions error:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching sessions',
        code: 'SESSIONS_FETCH_ERROR',
      });
    }
  });

  return router;
};

module.exports = setupAuthRoutes;
