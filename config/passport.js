const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// Helper function to extract Google OAuth credentials from service account JSON
function getGoogleOAuthCredentials() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is required');
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON format - must be valid JSON');
  }

  // Extract OAuth credentials from service account JSON
  // These would be additional fields in the service account JSON
  const clientId = credentials.oauth_client_id || credentials.client_id;
  const clientSecret = credentials.oauth_client_secret || credentials.client_secret;

  if (!clientId || !clientSecret) {
    throw new Error('OAuth client_id and client_secret must be included in GOOGLE_SERVICE_ACCOUNT_JSON');
  }

  return { clientId, clientSecret };
}

class AuthService {
  constructor(cache) {
    this.cache = cache;
    this.setupGoogleStrategy();
  }

  setupGoogleStrategy() {
    try {
      const { clientId, clientSecret } = getGoogleOAuthCredentials();

      passport.use(new GoogleStrategy({
        clientID: clientId,
        clientSecret: clientSecret,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback"
      },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const userData = {
          google_id: profile.id,
          email: profile.emails[0].value,
          name: profile.displayName,
          picture: profile.photos[0].value
        };

        let user = await this.findOrCreateUser(userData);

        user.last_login_at = Math.floor(Date.now() / 1000);
        await this.updateUser(user.id, { last_login_at: user.last_login_at });

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
      }));

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

      console.log('✓ Google OAuth Strategy initialized successfully');
    } catch (error) {
      console.error('✗ Failed to initialize Google OAuth Strategy:', error.message);
      console.warn('⚠ Continuing without Google OAuth - auth routes will not be available');
      // Don't throw error - allow app to continue without auth
    }
  }

  async findOrCreateUser(userData) {
    const existingUser = await this.getUserByEmail(userData.email);

    if (existingUser) {
      await this.updateUser(existingUser.id, {
        name: userData.name,
        picture: userData.picture,
        google_id: userData.google_id,
        updated_at: Math.floor(Date.now() / 1000)
      });
      return { ...existingUser, ...userData };
    }

    const userId = uuidv4();
    const newUser = {
      id: userId,
      ...userData,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
      last_login_at: Math.floor(Date.now() / 1000),
      is_active: true
    };

    await this.createUser(newUser);
    return newUser;
  }

  async createUser(userData) {
    const sql = `
      INSERT INTO users (id, email, name, picture, google_id, created_at, updated_at, last_login_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await this.cache.dbManager.run(sql, [
      userData.id,
      userData.email,
      userData.name,
      userData.picture,
      userData.google_id,
      userData.created_at,
      userData.updated_at,
      userData.last_login_at,
      userData.is_active ? 1 : 0
    ]);

    return result.changes > 0;
  }

  async getUserById(userId) {
    const sql = 'SELECT * FROM users WHERE id = ? AND is_active = 1';
    const user = await this.cache.dbManager.get(sql, [userId]);
    return user;
  }

  async getUserByEmail(email) {
    const sql = 'SELECT * FROM users WHERE email = ? AND is_active = 1';
    const user = await this.cache.dbManager.get(sql, [email]);
    return user;
  }

  async getUserByGoogleId(googleId) {
    const sql = 'SELECT * FROM users WHERE google_id = ? AND is_active = 1';
    const user = await this.cache.dbManager.get(sql, [googleId]);
    return user;
  }

  async updateUser(userId, updateData) {
    updateData.updated_at = Math.floor(Date.now() / 1000);

    const fields = Object.keys(updateData);
    const values = Object.values(updateData);
    const setClause = fields.map(field => `${field} = ?`).join(', ');

    const sql = `UPDATE users SET ${setClause} WHERE id = ?`;
    const result = await this.cache.dbManager.run(sql, [...values, userId]);

    return result.changes > 0;
  }

  async setRealDebridApiKey(userId, apiKey) {
    const encryptedKey = apiKey ? await bcrypt.hash(apiKey, 12) : null;

    const result = await this.updateUser(userId, {
      real_debrid_api_key: encryptedKey
    });

    return result;
  }

  async getRealDebridApiKey(userId) {
    const user = await this.getUserById(userId);
    return user?.real_debrid_api_key || null;
  }

  async createSession(userId, sessionData) {
    const sessionId = uuidv4();
    const sessionToken = uuidv4();
    const expiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days

    const sql = `
      INSERT INTO user_sessions (id, user_id, session_token, expires_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const result = await this.cache.dbManager.run(sql, [
      sessionId,
      userId,
      sessionToken,
      expiresAt,
      sessionData.userAgent || null,
      sessionData.ipAddress || null
    ]);

    if (result.changes > 0) {
      return {
        id: sessionId,
        token: sessionToken,
        expiresAt
      };
    }

    return null;
  }

  async validateSession(sessionToken) {
    const sql = `
      SELECT s.*, u.* FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.session_token = ? AND s.expires_at > ? AND u.is_active = 1
    `;

    const currentTime = Math.floor(Date.now() / 1000);
    const session = await this.cache.dbManager.get(sql, [sessionToken, currentTime]);

    if (session) {
      await this.updateSessionAccess(session.id);
    }

    return session;
  }

  async updateSessionAccess(sessionId) {
    const sql = 'UPDATE user_sessions SET last_accessed_at = ? WHERE id = ?';
    const currentTime = Math.floor(Date.now() / 1000);
    await this.cache.dbManager.run(sql, [currentTime, sessionId]);
  }

  async deleteSession(sessionToken) {
    const sql = 'DELETE FROM user_sessions WHERE session_token = ?';
    const result = await this.cache.dbManager.run(sql, [sessionToken]);
    return result.changes > 0;
  }

  async cleanupExpiredSessions() {
    const sql = 'DELETE FROM user_sessions WHERE expires_at <= ?';
    const currentTime = Math.floor(Date.now() / 1000);
    const result = await this.cache.dbManager.run(sql, [currentTime]);
    return result.changes;
  }
}

module.exports = AuthService;