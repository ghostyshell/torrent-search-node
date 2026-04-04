const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// Helper function to extract Google OAuth credentials from service account JSON
function getGoogleOAuthCredentials() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON environment variable is required'
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error(
      'Invalid GOOGLE_SERVICE_ACCOUNT_JSON format - must be valid JSON'
    );
  }

  // Extract OAuth credentials from service account JSON
  // These would be additional fields in the service account JSON
  const clientId = credentials.oauth_client_id || credentials.client_id;
  const clientSecret =
    credentials.oauth_client_secret || credentials.client_secret;

  if (!clientId || !clientSecret) {
    throw new Error(
      'OAuth client_id and client_secret must be included in GOOGLE_SERVICE_ACCOUNT_JSON'
    );
  }

  return { clientId, clientSecret };
}

// Track if Google strategy has been initialized
let googleStrategyInitialized = false;

class AuthService {
  constructor(cache) {
    this.cache = cache;
    // Only setup Google strategy once
    if (!googleStrategyInitialized) {
      this.setupGoogleStrategy();
      googleStrategyInitialized = true;
    }
  }

  setupGoogleStrategy() {
    try {
      const { clientId, clientSecret } = getGoogleOAuthCredentials();

      passport.use(
        new GoogleStrategy(
          {
            clientID: clientId,
            clientSecret: clientSecret,
            callbackURL:
              process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
          },
          async (accessToken, refreshToken, profile, done) => {
            try {
              // Google access tokens expire in 1 hour (3600 seconds)
              const tokenExpiresAt = Math.floor(Date.now() / 1000) + 3600;

              const userData = {
                id: profile.id,
                google_id: profile.id,
                email: profile.emails[0].value,
                name: profile.displayName,
                picture: profile.photos[0].value,
                last_login_at: Math.floor(Date.now() / 1000),
                // Store OAuth tokens for background refresh
                google_access_token: accessToken,
                google_refresh_token: refreshToken,
                google_token_expires_at: tokenExpiresAt,
              };

              // Temporary: Skip database operations and return user data directly
              // TODO: Re-enable database operations once database is properly initialized
              return done(null, userData);
            } catch (error) {
              console.error('Google OAuth strategy error:', error);
              return done(error, null);
            }
          }
        )
      );

      passport.serializeUser((user, done) => {
        done(null, user.id);
      });

      passport.deserializeUser(async (userId, done) => {
        try {
          const user = await this.getUserById(userId);
          done(null, user);
        } catch (error) {
          done(error, null);
        }
      });
    } catch (error) {
      console.error(
        '✗ Failed to initialize Google OAuth Strategy:',
        error.message
      );
      console.warn(
        '⚠ Continuing without Google OAuth - auth routes will not be available'
      );
      // Don't throw error - allow app to continue without auth
    }
  }

  async findOrCreateUser(userData) {
    try {
      const existingUser = await this.getUserByEmail(userData.email);

      if (existingUser) {
        try {
          const updateData = {
            name: userData.name,
            picture: userData.picture,
            google_id: userData.google_id,
            updated_at: Math.floor(Date.now() / 1000),
          };
          // Update Google tokens if provided
          if (userData.google_access_token) {
            updateData.google_access_token = userData.google_access_token;
          }
          if (userData.google_refresh_token) {
            updateData.google_refresh_token = userData.google_refresh_token;
          }
          if (userData.google_token_expires_at) {
            updateData.google_token_expires_at = userData.google_token_expires_at;
          }
          await this.updateUser(existingUser.id, updateData);
        } catch (updateError) {
          console.warn(
            'User update failed (gracefully handled):',
            updateError.message
          );
        }
        return { ...existingUser, ...userData };
      }

      const userId = uuidv4();
      const newUser = {
        id: userId,
        email: userData.email,
        name: userData.name,
        picture: userData.picture,
        google_id: userData.google_id,
        google_access_token: userData.google_access_token || null,
        google_refresh_token: userData.google_refresh_token || null,
        google_token_expires_at: userData.google_token_expires_at || null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
        last_login_at: Math.floor(Date.now() / 1000),
        is_active: true,
      };

      try {
        await this.createUser(newUser);
      } catch (createError) {
        console.warn(
          'User creation failed (gracefully handled):',
          createError.message
        );
      }
      return newUser;
    } catch (error) {
      console.warn(
        'findOrCreateUser error (gracefully handled):',
        error.message
      );
      // Return a temporary user object for testing/fallback scenarios
      return {
        id: uuidv4(),
        ...userData,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
        last_login_at: Math.floor(Date.now() / 1000),
        is_active: true,
      };
    }
  }

  async createUser(userData) {
    try {
      const sql = `
        INSERT INTO users (id, email, name, picture, google_id, google_access_token, google_refresh_token, google_token_expires_at, created_at, updated_at, last_login_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await this.cache.tursoClient.run(sql, [
        userData.id,
        userData.email,
        userData.name,
        userData.picture,
        userData.google_id,
        userData.google_access_token || null,
        userData.google_refresh_token || null,
        userData.google_token_expires_at || null,
        userData.created_at,
        userData.updated_at,
        userData.last_login_at,
        userData.is_active ? 1 : 0,
      ]);

      return result.changes > 0;
    } catch (error) {
      console.warn('createUser error (gracefully handled):', error.message);
      return false;
    }
  }

  async getUserById(userId) {
    // Check if database is properly initialized
    if (
      !this.cache ||
      !this.cache.tursoClient ||
      !this.cache.tursoClient.client ||
      !this.cache.isInitialized
    ) {
      return null;
    }

    try {
      const sql = 'SELECT * FROM users WHERE id = ? AND is_active = 1';
      const user = await this.cache.tursoClient.get(sql, [userId]);
      return user;
    } catch (error) {
      if (error.message.includes('Database client not initialized')) {
        return null;
      }
      throw error;
    }
  }

  async getUserByEmail(email) {
    // Check if database is properly initialized
    if (
      !this.cache ||
      !this.cache.tursoClient ||
      !this.cache.tursoClient.client ||
      !this.cache.isInitialized
    ) {
      return null;
    }

    try {
      const sql = 'SELECT * FROM users WHERE email = ? AND is_active = 1';
      const user = await this.cache.tursoClient.get(sql, [email]);
      return user;
    } catch (error) {
      if (error.message.includes('Database client not initialized')) {
        return null;
      }
      console.warn('getUserByEmail error (gracefully handled):', error.message);
      return null; // Gracefully handle any database errors
    }
  }

  async getUserByGoogleId(googleId) {
    try {
      const sql = 'SELECT * FROM users WHERE google_id = ? AND is_active = 1';
      const user = await this.cache.tursoClient.get(sql, [googleId]);
      return user;
    } catch (error) {
      console.warn(
        'getUserByGoogleId error (gracefully handled):',
        error.message
      );
      return null;
    }
  }

  async updateUser(userId, updateData) {
    try {
      updateData.updated_at = Math.floor(Date.now() / 1000);

      const fields = Object.keys(updateData);
      const values = Object.values(updateData);
      const setClause = fields.map((field) => `${field} = ?`).join(', ');

      const sql = `UPDATE users SET ${setClause} WHERE id = ?`;
      const result = await this.cache.tursoClient.run(sql, [...values, userId]);

      return result.changes > 0;
    } catch (error) {
      console.warn('updateUser error (gracefully handled):', error.message);
      return false;
    }
  }

  async setRealDebridApiKey(userId, apiKey) {
    const encryptedKey = apiKey ? await bcrypt.hash(apiKey, 12) : null;

    const result = await this.updateUser(userId, {
      real_debrid_api_key: encryptedKey,
    });

    return result;
  }

  async getRealDebridApiKey(userId) {
    const user = await this.getUserById(userId);
    return user?.real_debrid_api_key || null;
  }

  /**
   * Get all active users that have a Real-Debrid API key configured.
   * Used by background jobs that need to process per-user RD accounts.
   * @returns {Promise<Array<{id: string, real_debrid_api_key: string}>>}
   */
  async getUsersWithRealDebridKeys() {
    try {
      const sql = `
        SELECT id, real_debrid_api_key FROM users
        WHERE real_debrid_api_key IS NOT NULL AND real_debrid_api_key != '' AND is_active = 1
      `;
      const users = await this.cache.tursoClient.all(sql, []);
      return users || [];
    } catch (error) {
      console.warn('getUsersWithRealDebridKeys error:', error.message);
      return [];
    }
  }

  async createSession(userId, sessionData) {
    try {
      const sessionId = uuidv4();
      const sessionToken = uuidv4();
      // Session never expires (100 years) - user must manually log out
      const expiresAt = Math.floor(Date.now() / 1000) + 100 * 365 * 24 * 60 * 60; // 100 years

      const sql = `
        INSERT INTO user_sessions (id, user_id, session_token, expires_at, user_agent, ip_address)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      const result = await this.cache.tursoClient.run(sql, [
        sessionId,
        userId,
        sessionToken,
        expiresAt,
        sessionData.userAgent || null,
        sessionData.ipAddress || null,
      ]);

      if (result.changes > 0) {
        return {
          id: sessionId,
          token: sessionToken,
          expiresAt,
        };
      }

      return null;
    } catch (error) {
      console.warn('createSession error (gracefully handled):', error.message);
      return null;
    }
  }

  async validateSession(sessionToken) {
    // Check if database is properly initialized
    if (
      !this.cache ||
      !this.cache.tursoClient ||
      !this.cache.tursoClient.client ||
      !this.cache.isInitialized
    ) {
      return null;
    }

    const sql = `
      SELECT s.*, u.* FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.session_token = ? AND s.expires_at > ? AND u.is_active = 1
    `;

    const currentTime = Math.floor(Date.now() / 1000);

    try {
      const session = await this.cache.tursoClient.get(sql, [
        sessionToken,
        currentTime,
      ]);

      if (session) {
        await this.updateSessionAccess(session.id);
      }

      return session;
    } catch (error) {
      // Handle database unavailability gracefully
      if (error.message.includes('Database client not initialized')) {
        return null; // No session found (graceful degradation)
      }
      console.warn(
        'Session validation error (gracefully handled):',
        error.message
      );
      return null; // Gracefully handle any database errors
    }
  }

  async updateSessionAccess(sessionId) {
    try {
      const sql = 'UPDATE user_sessions SET last_accessed_at = ? WHERE id = ?';
      const currentTime = Math.floor(Date.now() / 1000);
      await this.cache.tursoClient.run(sql, [currentTime, sessionId]);
    } catch (error) {
      console.warn(
        'Session access update failed (gracefully handled):',
        error.message
      );
    }
  }

  async deleteSession(sessionToken) {
    try {
      const sql = 'DELETE FROM user_sessions WHERE session_token = ?';
      const result = await this.cache.tursoClient.run(sql, [sessionToken]);
      return result.changes > 0;
    } catch (error) {
      console.warn('deleteSession error (gracefully handled):', error.message);
      return false;
    }
  }

  async cleanupExpiredSessions() {
    try {
      const sql = 'DELETE FROM user_sessions WHERE expires_at <= ?';
      const currentTime = Math.floor(Date.now() / 1000);
      const result = await this.cache.tursoClient.run(sql, [currentTime]);
      return result.changes;
    } catch (error) {
      console.warn(
        'cleanupExpiredSessions error (gracefully handled):',
        error.message
      );
      return 0;
    }
  }

  // Get all users who have refresh tokens for background token refresh
  async getUsersWithRefreshTokens() {
    if (
      !this.cache ||
      !this.cache.tursoClient ||
      !this.cache.tursoClient.client ||
      !this.cache.isInitialized
    ) {
      return [];
    }

    try {
      const sql = `
        SELECT id, email, google_refresh_token, google_token_expires_at
        FROM users
        WHERE google_refresh_token IS NOT NULL AND is_active = 1
      `;
      const users = await this.cache.tursoClient.all(sql);
      return users || [];
    } catch (error) {
      console.warn('getUsersWithRefreshTokens error:', error.message);
      return [];
    }
  }

  // Refresh Google access token for a specific user
  async refreshGoogleToken(userId) {
    try {
      const user = await this.getUserById(userId);
      if (!user || !user.google_refresh_token) {
        return { success: false, error: 'No refresh token available' };
      }

      const { clientId, clientSecret } = getGoogleOAuthCredentials();

      // Call Google's token endpoint to refresh the access token
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: user.google_refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.warn(`Failed to refresh token for user ${userId}:`, errorData);
        return { success: false, error: errorData.error_description || 'Token refresh failed' };
      }

      const tokenData = await response.json();

      // Google access tokens expire in 1 hour (3600 seconds)
      const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600);

      // Update the user's access token
      await this.updateUser(userId, {
        google_access_token: tokenData.access_token,
        google_token_expires_at: expiresAt,
      });

      return { success: true, expiresAt };
    } catch (error) {
      console.warn(`Token refresh error for user ${userId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // Refresh all users' Google tokens that are about to expire
  async refreshAllGoogleTokens() {
    const users = await this.getUsersWithRefreshTokens();
    const currentTime = Math.floor(Date.now() / 1000);
    // Refresh tokens that expire within the next 10 minutes
    const refreshThreshold = currentTime + 10 * 60;

    let refreshed = 0;
    let failed = 0;

    for (const user of users) {
      // Only refresh if token expires within threshold or has no expiry time
      if (!user.google_token_expires_at || user.google_token_expires_at <= refreshThreshold) {
        const result = await this.refreshGoogleToken(user.id);
        if (result.success) {
          refreshed++;
        } else {
          failed++;
        }
      }
    }

    return { refreshed, failed, total: users.length };
  }
}

module.exports = AuthService;
