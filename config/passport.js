const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const { encryptSecret, decryptSecret } = require('../utils/secretCrypto');

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
              const userData = {
                id: profile.id,
                google_id: profile.id,
                email: profile.emails[0].value,
                name: profile.displayName,
                picture: profile.photos[0].value,
                last_login_at: Math.floor(Date.now() / 1000),
              };

              const user = await this.findOrCreateUser(userData);
              return done(null, user);
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
    return this.cache.authStore.createUser(userData);
  }

  async getUserById(userId) {
    return this.cache.authStore.getUserById(userId);
  }

  async getUserByEmail(email) {
    return this.cache.authStore.getUserByEmail(email);
  }

  async getUserByGoogleId(googleId) {
    return this.cache.authStore.getUserByGoogleId(googleId);
  }

  async updateUser(userId, updateData) {
    updateData.updated_at = Math.floor(Date.now() / 1000);
    return this.cache.authStore.updateUser(userId, updateData);
  }

  async setRealDebridApiKey(userId, apiKey) {
    const encryptedKey = apiKey ? encryptSecret(apiKey) : null;

    return this.updateUser(userId, {
      real_debrid_api_key: encryptedKey,
    });
  }

  async getRealDebridApiKey(userId) {
    const user = await this.getUserById(userId);
    if (!user?.real_debrid_api_key) return null;
    return decryptSecret(user.real_debrid_api_key);
  }

  decryptApiKey(storedKey) {
    return decryptSecret(storedKey);
  }

  /**
   * Get all active users that have a Real-Debrid API key configured.
   * Used by background jobs that need to process per-user RD accounts.
   * @returns {Promise<Array<{id: string, real_debrid_api_key: string}>>}
   */
  async getUsersWithRealDebridKeys() {
    return this.cache.authStore.getUsersWithRealDebridKeys();
  }

  async createSession(userId, sessionData) {
    return this.cache.authStore.createSession(userId, sessionData);
  }

  async validateSession(sessionToken) {
    return this.cache.authStore.validateSession(sessionToken);
  }

  async updateSessionAccess(sessionId) {
    return this.cache.authStore.updateSessionAccess(sessionId);
  }

  async deleteSession(sessionToken) {
    return this.cache.authStore.deleteSession(sessionToken);
  }

  async cleanupExpiredSessions() {
    return this.cache.authStore.cleanupExpiredSessions();
  }

  async createExchangeCode(sessionToken) {
    return this.cache.authStore.createExchangeCode(sessionToken);
  }

  async consumeExchangeCode(code) {
    return this.cache.authStore.consumeExchangeCode(code);
  }

}

module.exports = AuthService;
