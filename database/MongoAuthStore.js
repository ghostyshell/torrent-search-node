'use strict';

/**
 * MongoAuthStore — users + user_sessions backed by MongoDB.
 *
 * Used by config/passport.js for all auth. Method names and return shapes match
 * what the auth middleware/routes expect:
 *   - getUser* return the raw user document (snake_case fields).
 *   - validateSession returns the session merged with its user (so consumers can
 *     read user_id, email, name, picture, and id — the session id).
 */

const { v4: uuidv4 } = require('uuid');

const nowSec = () => Math.floor(Date.now() / 1000);

class MongoAuthStore {
  constructor(mongoClient) {
    this.mongo = mongoClient;
  }

  users() { return this.mongo.collection('users'); }
  sessions() { return this.mongo.collection('user_sessions'); }

  // ── Users ───────────────────────────────────────────────────────────────

  async createUser(userData) {
    const doc = {
      _id: userData.id,
      id: userData.id,
      email: userData.email,
      name: userData.name,
      picture: userData.picture,
      google_id: userData.google_id,
      real_debrid_api_key: userData.real_debrid_api_key || null,
      created_at: userData.created_at,
      updated_at: userData.updated_at,
      last_login_at: userData.last_login_at,
      is_active: userData.is_active ? 1 : 0,
    };
    await this.users().replaceOne({ _id: doc._id }, doc, { upsert: true });
    return true;
  }

  async getUserById(userId) {
    return this.users().findOne({ _id: userId, is_active: 1 });
  }

  async getUserByEmail(email) {
    return this.users().findOne({ email, is_active: 1 });
  }

  async getUserByGoogleId(googleId) {
    return this.users().findOne({ google_id: googleId, is_active: 1 });
  }

  async updateUser(userId, updateData) {
    const set = { ...updateData };
    if (set.is_active !== undefined) set.is_active = set.is_active ? 1 : 0;
    const res = await this.users().updateOne({ _id: userId }, { $set: set });
    return res.modifiedCount > 0;
  }

  async getUsersWithRealDebridKeys() {
    return this.users()
      .find({ real_debrid_api_key: { $nin: [null, ''] }, is_active: 1 })
      .project({ _id: 0, id: 1, real_debrid_api_key: 1 })
      .toArray();
  }

  // ── Sessions ────────────────────────────────────────────────────────────

  async createSession(userId, sessionData) {
    const sessionId = uuidv4();
    const sessionToken = uuidv4();
    const expiresAt = nowSec() + 100 * 365 * 24 * 60 * 60; // 100 years
    const doc = {
      _id: sessionId,
      id: sessionId,
      user_id: userId,
      session_token: sessionToken,
      expires_at: expiresAt,
      user_agent: sessionData.userAgent || null,
      ip_address: sessionData.ipAddress || null,
      created_at: nowSec(),
      last_accessed_at: nowSec(),
    };
    await this.sessions().insertOne(doc);
    return { id: sessionId, token: sessionToken, expiresAt };
  }

  async validateSession(sessionToken) {
    const session = await this.sessions().findOne({
      session_token: sessionToken,
      expires_at: { $gt: nowSec() },
    });
    if (!session) return null;

    const user = await this.users().findOne({ _id: session.user_id, is_active: 1 });
    if (!user) return null;

    await this.updateSessionAccess(session.id);

    // Merge user then session so consumers get user_id (session), email/name/
    // picture (user) and id (session id, used as sessionId).
    return { ...user, ...session };
  }

  async updateSessionAccess(sessionId) {
    await this.sessions().updateOne({ _id: sessionId }, { $set: { last_accessed_at: nowSec() } });
  }

  async deleteSession(sessionToken) {
    const res = await this.sessions().deleteOne({ session_token: sessionToken });
    return res.deletedCount > 0;
  }

  async cleanupExpiredSessions() {
    const res = await this.sessions().deleteMany({ expires_at: { $lte: nowSec() } });
    return res.deletedCount || 0;
  }
}

module.exports = MongoAuthStore;
