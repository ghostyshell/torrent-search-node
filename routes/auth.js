const express = require('express');
const passport = require('passport');
const router = express.Router();
const AuthService = require('../config/passport');
const AuthMiddleware = require('../middleware/auth');
const bcrypt = require('bcryptjs');

const setupAuthRoutes = (cache) => {
  console.log('setupAuthRoutes called with cache:', !!cache);

  const authService = new AuthService(cache);
  console.log('AuthService created');

  // Pass the authService instance to AuthMiddleware instead of creating a new one
  const authMiddleware = new AuthMiddleware(cache, authService);
  console.log('AuthMiddleware created');

  router.get('/google',
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      prompt: 'select_account'
    })
  );

  router.get('/google/callback',
    passport.authenticate('google', {
      failureRedirect: process.env.FRONTEND_URL + '/login?error=auth_failed',
      session: false
    }),
    async (req, res) => {
      try {
        const sessionData = {
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip || req.connection.remoteAddress
        };

        const session = await authService.createSession(req.user.id, sessionData);

        if (!session) {
          return res.redirect(process.env.FRONTEND_URL + '/login?error=session_failed');
        }

        const redirectUrl = new URL(process.env.FRONTEND_URL || 'http://localhost:3000');
        redirectUrl.searchParams.append('token', session.token);
        redirectUrl.searchParams.append('user', JSON.stringify({
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          picture: req.user.picture
        }));

        res.redirect(redirectUrl.toString());
      } catch (error) {
        console.error('Google callback error:', error);
        res.redirect(process.env.FRONTEND_URL + '/login?error=callback_failed');
      }
    }
  );

  router.post('/logout', authMiddleware.requireAuth(), async (req, res) => {
    try {
      const sessionToken = req.headers.authorization?.replace('Bearer ', '') ||
                         req.cookies?.sessionToken ||
                         req.session?.sessionToken;

      if (sessionToken) {
        await authService.deleteSession(sessionToken);
      }

      res.clearCookie('sessionToken');

      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        error: 'Logout failed',
        code: 'LOGOUT_ERROR'
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
          code: 'USER_NOT_FOUND'
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
          lastLoginAt: user.last_login_at
        }
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching user data',
        code: 'USER_FETCH_ERROR'
      });
    }
  });

  router.post('/realdebrid/api-key', authMiddleware.requireAuth(), async (req, res) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey || typeof apiKey !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Valid API key is required',
          code: 'INVALID_API_KEY'
        });
      }

      const success = await authService.updateUser(req.userId, {
        real_debrid_api_key: apiKey
      });

      if (!success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to save API key',
          code: 'SAVE_ERROR'
        });
      }

      res.json({
        success: true,
        message: 'Real Debrid API key saved successfully'
      });
    } catch (error) {
      console.error('Save Real Debrid API key error:', error);
      res.status(500).json({
        success: false,
        error: 'Error saving API key',
        code: 'SAVE_ERROR'
      });
    }
  });

  router.delete('/realdebrid/api-key', authMiddleware.requireAuth(), async (req, res) => {
    try {
      const success = await authService.updateUser(req.userId, {
        real_debrid_api_key: null
      });

      if (!success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to remove API key',
          code: 'REMOVE_ERROR'
        });
      }

      res.json({
        success: true,
        message: 'Real Debrid API key removed successfully'
      });
    } catch (error) {
      console.error('Remove Real Debrid API key error:', error);
      res.status(500).json({
        success: false,
        error: 'Error removing API key',
        code: 'REMOVE_ERROR'
      });
    }
  });

  router.post('/validate', async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Token is required',
          code: 'MISSING_TOKEN'
        });
      }

      const userSession = await authService.validateSession(token);

      if (!userSession) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN'
        });
      }

      res.json({
        success: true,
        user: {
          id: userSession.user_id,
          email: userSession.email,
          name: userSession.name,
          picture: userSession.picture,
          hasRealDebridKey: !!userSession.real_debrid_api_key
        }
      });
    } catch (error) {
      console.error('Token validation error:', error);
      res.status(500).json({
        success: false,
        error: 'Token validation failed',
        code: 'VALIDATION_ERROR'
      });
    }
  });

  router.get('/sessions', authMiddleware.requireAuth(), async (req, res) => {
    try {
      const sql = `
        SELECT id, session_token, created_at, last_accessed_at, user_agent, ip_address
        FROM user_sessions
        WHERE user_id = ? AND expires_at > ?
        ORDER BY last_accessed_at DESC
      `;

      const currentTime = Math.floor(Date.now() / 1000);
      const sessions = await cache.dbManager.all(sql, [req.userId, currentTime]);

      res.json({
        success: true,
        sessions: sessions.map(session => ({
          id: session.id,
          isCurrentSession: session.session_token === (req.headers.authorization?.replace('Bearer ', '') || req.cookies?.sessionToken),
          createdAt: session.created_at,
          lastAccessedAt: session.last_accessed_at,
          userAgent: session.user_agent,
          ipAddress: session.ip_address
        }))
      });
    } catch (error) {
      console.error('Get sessions error:', error);
      res.status(500).json({
        success: false,
        error: 'Error fetching sessions',
        code: 'SESSIONS_FETCH_ERROR'
      });
    }
  });

  console.log('setupAuthRoutes completed, returning router');
  return router;
};

module.exports = setupAuthRoutes;