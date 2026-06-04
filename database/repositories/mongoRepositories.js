'use strict';

/**
 * mongoRepositories.js
 *
 * MongoDB-backed implementations of the seven storage repositories, with the
 * SAME public interface and return shapes as their Turso counterparts. Used
 * only when EXPERIMENT_MONGODB is on: reads come from Mongo, and every write
 * also mirrors into Turso (via TursoMirror) so Turso stays a rollback standby.
 *
 * Documents use the same snake_case field names as the SQLite columns (that's
 * how the migration wrote them), so mapping back to the app's expected shapes
 * matches the Turso repositories exactly.
 */

const { v4: uuidv4 } = require('uuid');
const { config } = require('../../config/environment');
const objectStorageService = require('../../services/objectStorageService');

const nowSec = () => Math.floor(Date.now() / 1000);

// ── Shared base: connection + pure helpers (mirrors BaseRepository) ───────────

class MongoBase {
  constructor(mongoClient, mirror, table) {
    this.mongo = mongoClient;
    this.mirror = mirror;
    this.table = table;
  }

  coll() {
    return this.mongo.collection(this.table);
  }

  /** Re-read a doc by _id and mirror it into Turso (used after partial updates). */
  async _mirrorById(id) {
    const doc = await this.coll().findOne({ _id: id });
    if (doc) await this.mirror.upsert(this.table, doc);
  }

  // --- pure helpers copied from BaseRepository (no DB access) ---

  generateTorrentKey(torrent) {
    if (typeof torrent === 'string') return torrent;
    if (torrent.isCachedLink && torrent.cachedLinkId) {
      return `cached_link_${torrent.cachedLinkId}`;
    }
    const identifier = `${torrent.Name}_${torrent.Source}_${torrent.Size}`;
    let key = identifier.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    if (key.length > 200) {
      const hash = this.simpleHash(key);
      key = key.substring(0, 150) + '_' + hash;
    }
    return key;
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  extractMagnetHash(magnetLink) {
    const match = magnetLink.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
    if (match) return match[1].toLowerCase();
    return Buffer.from(magnetLink)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 40);
  }

  detectMimeType(buffer) {
    if (!Buffer.isBuffer(buffer)) return 'application/octet-stream';
    if (buffer.length >= 2) {
      if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
      if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
      if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
      if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
    }
    return 'application/octet-stream';
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────

class MongoCacheRepository extends MongoBase {
  constructor(mongo, mirror) { super(mongo, mirror, 'cache'); }

  async set(key, value, ttlSeconds = null, type = 'json', metadata = null) {
    const expiresAt = ttlSeconds ? nowSec() + ttlSeconds : null;
    const doc = {
      _id: key,
      key,
      value: type === 'json' ? JSON.stringify(value) : value,
      type,
      expires_at: expiresAt,
      metadata: metadata ? JSON.stringify(metadata) : null,
      created_at: nowSec(),
      updated_at: nowSec(),
    };
    await this.coll().replaceOne({ _id: key }, doc, { upsert: true });
    await this.mirror.upsert('cache', doc);
    return true;
  }

  async get(key, defaultValue = null) {
    const now = nowSec();
    const row = await this.coll().findOne({
      _id: key,
      $or: [{ expires_at: null }, { expires_at: { $gt: now } }],
    });
    if (!row) return defaultValue;
    try {
      return row.type === 'json' ? JSON.parse(row.value) : row.value;
    } catch (_) {
      return defaultValue;
    }
  }

  async delete(key) {
    const res = await this.coll().deleteOne({ _id: key });
    await this.mirror.delete('cache', { key });
    return res.deletedCount > 0;
  }

  async cleanupExpired() {
    const now = nowSec();
    const res = await this.coll().deleteMany({ expires_at: { $ne: null, $lte: now } });
    await this.mirror.run(`DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at <= ?`, [now]);
    return res.deletedCount || 0;
  }

  async getStats() {
    const now = nowSec();
    const totalEntries = await this.coll().countDocuments({});
    const expiredEntries = await this.coll().countDocuments({ expires_at: { $ne: null, $lte: now } });
    return { totalEntries, expiredEntries };
  }

  async clear() {
    const res = await this.coll().deleteMany({});
    await this.mirror.run('DELETE FROM cache', []);
    return res.deletedCount || 0;
  }
}

// ── Images ──────────────────────────────────────────────────────────────────

class MongoImageRepository extends MongoBase {
  constructor(mongo, mirror) {
    super(mongo, mirror, 'images');
    this.objectStorageService = objectStorageService;
  }

  _idFor(torrentKey) { return `${torrentKey}::cover`; }

  async setCoverImage(torrent, imageUrl) {
    const torrentKey = this.generateTorrentKey(torrent);
    try {
      const { key, error } = await this.objectStorageService.uploadCoverFromUrl({
        torrentKey,
        imageUrl,
        isFavorite: !!torrent.favoriteEntryId,
      });
      if (!key) {
        console.warn('⚠️ [MongoImageRepository] S3 upload failed:', error);
        return false;
      }
      const presignedUrl = await this.objectStorageService.getPresignedUrl(key);
      const doc = {
        _id: this._idFor(torrentKey),
        torrent_key: torrentKey,
        image_type: 'cover',
        pixhost_url: presignedUrl,
        original_url: imageUrl,
        torrent_name: torrent.Name || 'Unknown',
        storage_key: key,
        created_at: nowSec(),
      };
      await this.coll().replaceOne({ _id: doc._id }, doc, { upsert: true });
      await this.mirror.upsert('images', doc);
      return true;
    } catch (error) {
      console.error(`❌ [MongoImageRepository] setCoverImage ${torrent.Name}:`, error.message);
      return false;
    }
  }

  _mapCover(row) {
    if (!row || !row.pixhost_url) return null;
    return {
      type: 'url',
      imageUrl: row.pixhost_url,
      originalUrl: row.pixhost_url,
      fallbackUrls: [],
      storageKey: row.storage_key,
    };
  }

  async getCoverImage(torrent) {
    return this.getCoverImageByKey(this.generateTorrentKey(torrent));
  }

  async getCoverImageByKey(torrentKey) {
    const row = await this.coll().findOne({ _id: this._idFor(torrentKey) });
    return this._mapCover(row);
  }

  async getCoverImagesByKeys(torrentKeys) {
    const result = new Map();
    if (!Array.isArray(torrentKeys) || torrentKeys.length === 0) return result;
    const uniqueKeys = [...new Set(torrentKeys)];
    const rows = await this.coll()
      .find({ image_type: 'cover', torrent_key: { $in: uniqueKeys } })
      .toArray();
    for (const row of rows) {
      const mapped = this._mapCover(row);
      if (mapped) result.set(row.torrent_key, mapped);
    }
    return result;
  }

  async hasCoverImage(torrent) {
    const torrentKey = this.generateTorrentKey(torrent);
    const row = await this.coll().findOne({
      _id: this._idFor(torrentKey),
      pixhost_url: { $ne: null },
    });
    return !!row;
  }

  async updateCoverImageUrl(torrentKey, imageUrl) {
    const res = await this.coll().updateOne(
      { _id: this._idFor(torrentKey) },
      { $set: { pixhost_url: imageUrl } }
    );
    await this._mirrorById(this._idFor(torrentKey));
    return res.modifiedCount > 0;
  }

  async getObjectStorageCovers(limit = 200, offset = 0) {
    return this.coll()
      .find({ image_type: 'cover', storage_key: { $ne: null } })
      .project({ torrent_key: 1, storage_key: 1, _id: 0 })
      .sort({ torrent_key: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  async updateCoverPresignedUrl(torrentKey, presignedUrl) {
    return this.updateCoverImageUrl(torrentKey, presignedUrl);
  }

  async deleteCoverByStorageKey(storageKey) {
    const res = await this.coll().deleteOne({ image_type: 'cover', storage_key: storageKey });
    await this.mirror.delete('images', { image_type: 'cover', storage_key: storageKey });
    return res.deletedCount > 0;
  }

  async deleteCoverImage(torrent) {
    const torrentKey = typeof torrent === 'string' ? torrent : this.generateTorrentKey(torrent);
    const res = await this.coll().deleteOne({ _id: this._idFor(torrentKey) });
    await this.mirror.delete('images', { torrent_key: torrentKey, image_type: 'cover' });
    return res.deletedCount > 0;
  }

  async getAllCoverImages(limit = 50, offset = 0) {
    return this.coll()
      .find({ image_type: 'cover' })
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  async getStats() {
    const totalImages = await this.coll().countDocuments({ image_type: 'cover' });
    const withObjectStorage = await this.coll().countDocuments({ image_type: 'cover', storage_key: { $ne: null } });
    return { totalImages, withObjectStorage };
  }
}

// ── Stream URLs ───────────────────────────────────────────────────────────────

class MongoStreamUrlRepository extends MongoBase {
  constructor(mongo, mirror) { super(mongo, mirror, 'stream_urls'); }

  async setStreamUrl(magnetLink, streamData) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    const doc = {
      _id: magnetHash,
      magnet_hash: magnetHash,
      stream_url: streamData.streamUrl,
      filename: streamData.filename || null,
      filesize: streamData.filesize || null,
      supports_range_requests: streamData.supportsRangeRequests ? 1 : 0,
      torrent_name: streamData.torrentName || null,
      created_at: nowSec(),
      last_accessed_at: nowSec(),
    };
    await this.coll().replaceOne({ _id: magnetHash }, doc, { upsert: true });
    await this.mirror.upsert('stream_urls', doc);
    return true;
  }

  _ttlFilter(magnetHash) {
    const ttlSeconds = config.cache && config.cache.streamUrlTtlSeconds;
    const filter = { _id: magnetHash };
    if (ttlSeconds) filter.created_at = { $gt: nowSec() - ttlSeconds };
    return filter;
  }

  async getStreamUrl(magnetLink) {
    return this.getStreamUrlByHash(this.extractMagnetHash(magnetLink));
  }

  async getStreamUrlByHash(magnetHash) {
    const row = await this.coll().findOne(this._ttlFilter(magnetHash));
    if (!row) return null;

    const accessed = nowSec();
    await this.coll().updateOne({ _id: magnetHash }, { $set: { last_accessed_at: accessed } });
    await this.mirror.run('UPDATE stream_urls SET last_accessed_at = ? WHERE magnet_hash = ?', [accessed, magnetHash]);

    return {
      streamUrl: row.stream_url,
      filename: row.filename,
      filesize: row.filesize,
      supportsRangeRequests: !!row.supports_range_requests,
      cachedAt: row.created_at * 1000,
      lastAccessed: accessed * 1000,
    };
  }

  async hasStreamUrl(magnetLink) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    const row = await this.coll().findOne(this._ttlFilter(magnetHash));
    return !!row;
  }

  async deleteStreamUrl(magnetLink) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    const res = await this.coll().deleteOne({ _id: magnetHash });
    await this.mirror.delete('stream_urls', { magnet_hash: magnetHash });
    return res.deletedCount > 0;
  }

  async cleanupOldStreamUrls(maxEntries = 100) {
    const count = await this.coll().countDocuments({});
    if (count <= maxEntries) return 0;
    const toDelete = count - maxEntries;
    const victims = await this.coll()
      .find({})
      .sort({ last_accessed_at: 1 })
      .limit(toDelete)
      .project({ _id: 1 })
      .toArray();
    const ids = victims.map((v) => v._id);
    if (ids.length === 0) return 0;
    const res = await this.coll().deleteMany({ _id: { $in: ids } });
    const placeholders = ids.map(() => '?').join(',');
    await this.mirror.run(`DELETE FROM stream_urls WHERE magnet_hash IN (${placeholders})`, ids);
    return res.deletedCount || 0;
  }

  async getAllStreamUrls(limit = 50, offset = 0) {
    return this.coll().find({}).sort({ last_accessed_at: -1 }).skip(offset).limit(limit).toArray();
  }

  async getStats() {
    return { totalStreamUrls: await this.coll().countDocuments({}) };
  }
}

// ── Cached links ──────────────────────────────────────────────────────────────

class MongoCachedLinkRepository extends MongoBase {
  constructor(mongo, mirror) { super(mongo, mirror, 'cached_links'); }

  _map(row) {
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      dateAdded: row.date_added,
      streamUrl: row.stream_url,
      streamUrlCachedAt: row.stream_url_cached_at,
      isStreaming: !!row.is_streaming,
      error: row.error,
      supportsRangeRequests: !!row.supports_range_requests,
      filename: row.filename,
      coverImageUrl: row.cover_image_url,
      userId: row.user_id,
    };
  }

  async addCachedLink(cachedLink, userId = null) {
    const doc = {
      _id: cachedLink.id,
      id: cachedLink.id,
      url: cachedLink.url,
      title: cachedLink.title,
      date_added: cachedLink.dateAdded,
      stream_url: cachedLink.streamUrl || null,
      stream_url_cached_at: cachedLink.streamUrlCachedAt || null,
      is_streaming: cachedLink.isStreaming ? 1 : 0,
      error: cachedLink.error || null,
      supports_range_requests: cachedLink.supportsRangeRequests ? 1 : 0,
      filename: cachedLink.filename || null,
      cover_image_url: cachedLink.coverImageUrl || null,
      user_id: userId,
    };
    await this.coll().replaceOne({ _id: doc._id }, doc, { upsert: true });
    await this.mirror.upsert('cached_links', doc);
    return true;
  }

  async getCachedLinkById(id, userId = null) {
    const filter = userId ? { _id: id, user_id: userId } : { _id: id };
    const row = await this.coll().findOne(filter);
    return row ? this._map(row) : null;
  }

  async getCachedLinks(page = 1, limit = 20, userId = null) {
    const offset = (page - 1) * limit;
    const filter = userId ? { user_id: userId } : { user_id: null };
    const totalCount = await this.coll().countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);
    const rows = await this.coll()
      .find(filter)
      .sort({ date_added: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return {
      cachedLinks: rows.map((r) => this._map(r)),
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async updateCachedLink(id, updates, userId = null) {
    const set = {};
    if (updates.title !== undefined) set.title = updates.title;
    if (updates.streamUrl !== undefined) set.stream_url = updates.streamUrl;
    if (updates.streamUrlCachedAt !== undefined) set.stream_url_cached_at = updates.streamUrlCachedAt;
    if (updates.isStreaming !== undefined) set.is_streaming = updates.isStreaming ? 1 : 0;
    if (updates.error !== undefined) set.error = updates.error;
    if (updates.supportsRangeRequests !== undefined) set.supports_range_requests = updates.supportsRangeRequests ? 1 : 0;
    if (updates.filename !== undefined) set.filename = updates.filename;
    if (updates.coverImageUrl !== undefined) set.cover_image_url = updates.coverImageUrl;
    if (Object.keys(set).length === 0) return false;

    const filter = userId ? { _id: id, user_id: userId } : { _id: id, user_id: null };
    const res = await this.coll().updateOne(filter, { $set: set });
    await this._mirrorById(id);
    return res.modifiedCount > 0;
  }

  async updateCoverImage(cachedLinkId, coverImageUrl) {
    const res = await this.coll().updateOne({ _id: cachedLinkId }, { $set: { cover_image_url: coverImageUrl } });
    await this._mirrorById(cachedLinkId);
    return res.modifiedCount > 0;
  }

  async removeCachedLink(id, userId = null) {
    const filter = userId ? { _id: id, user_id: userId } : { _id: id, user_id: null };
    const res = await this.coll().deleteOne(filter);
    await this.mirror.delete('cached_links', userId ? { id, user_id: userId } : { id, user_id: null });
    return res.deletedCount > 0;
  }

  async getStats() {
    return { totalCachedLinks: await this.coll().countDocuments({}) };
  }
}

// ── Favorites ─────────────────────────────────────────────────────────────────

class MongoFavoriteRepository extends MongoBase {
  constructor(mongo, mirror) { super(mongo, mirror, 'favorite_entries'); }

  _map(row) {
    return {
      id: row.id,
      torrentKey: row.torrent_key,
      torrentData: JSON.parse(row.torrent_data),
      magnetLink: row.magnet_link,
      torrentName: row.torrent_name,
      coverImageUrl: row.cover_image_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createFavoriteEntry(torrent, coverImageUrl = null, userId = null) {
    const favoriteId = uuidv4();
    const torrentKey = this.generateTorrentKey(torrent);
    const doc = {
      _id: favoriteId,
      id: favoriteId,
      torrent_key: torrentKey,
      torrent_data: JSON.stringify(torrent),
      magnet_link: torrent.Magnet || torrent.MagnetLink || null,
      torrent_name: torrent.Name || 'Unknown',
      cover_image_url: coverImageUrl,
      user_id: userId,
      created_at: nowSec(),
      updated_at: nowSec(),
    };
    // Mirror SQLite's "INSERT OR REPLACE" against the UNIQUE(torrent_key,user_id):
    // remove any existing entry for this pair, then insert the new id.
    await this.coll().deleteOne({ torrent_key: torrentKey, user_id: userId });
    await this.coll().insertOne(doc);
    await this.mirror.upsert('favorite_entries', doc);
    return favoriteId;
  }

  async getFavoriteEntry(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const row = await this.coll().findOne({ torrent_key: torrentKey, user_id: userId });
    return row ? this._map(row) : null;
  }

  async getFavoriteEntryById(favoriteId) {
    const row = await this.coll().findOne({ _id: favoriteId });
    return row ? this._map(row) : null;
  }

  async getFavoriteEntryByKey(torrentKey) {
    const row = await this.coll().findOne({ torrent_key: torrentKey });
    return row ? this._map(row) : null;
  }

  async getFavoriteEntries(limit, offset, userId = null) {
    const filter = userId ? { user_id: userId } : {};
    const rows = await this.coll().find(filter).sort({ created_at: -1 }).skip(offset).limit(limit).toArray();
    return rows.map((r) => this._map(r));
  }

  // De-duplicate by COALESCE(magnet_link, id), keep most recent (created_at desc).
  async getMergedFavorites(limit, offset, userId = null) {
    const filter = userId ? { user_id: userId } : { user_id: null };
    const rows = await this.coll().find(filter).sort({ created_at: -1 }).toArray();
    const seen = new Set();
    const deduped = [];
    for (const row of rows) {
      const key = row.magnet_link || row.id;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }
    return deduped
      .slice(offset, offset + limit)
      .map((row) => {
        try {
          const torrentData = JSON.parse(row.torrent_data);
          return {
            ...torrentData,
            favoriteEntryId: row.id,
            favoriteEntryCoverImageUrl: row.cover_image_url || null,
            dateAdded: new Date(row.created_at * 1000).toISOString(),
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  }

  async getMergedFavoritesCount(userId = null) {
    const filter = userId ? { user_id: userId } : { user_id: null };
    const rows = await this.coll().find(filter).project({ magnet_link: 1, id: 1 }).toArray();
    const keys = new Set(rows.map((r) => r.magnet_link || r.id));
    return keys.size;
  }

  async isFavorite(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const row = await this.coll().findOne({ torrent_key: torrentKey, user_id: userId });
    return !!row;
  }

  async removeFavoriteEntry(favoriteId) {
    const res = await this.coll().deleteOne({ _id: favoriteId });
    await this.mirror.delete('favorite_entries', { id: favoriteId });
    return res.deletedCount > 0;
  }

  async updateCoverImage(favoriteId, coverImageUrl) {
    const res = await this.coll().updateOne({ _id: favoriteId }, { $set: { cover_image_url: coverImageUrl } });
    await this._mirrorById(favoriteId);
    return res.modifiedCount > 0;
  }

  async updateMagnetLink(favoriteId, magnetLink) {
    const res = await this.coll().updateOne(
      { _id: favoriteId },
      { $set: { magnet_link: magnetLink, updated_at: nowSec() } }
    );
    await this._mirrorById(favoriteId);
    return res.modifiedCount > 0;
  }

  async updateMagnetLinkAndData(favoriteId, magnetLink) {
    const entry = await this.getFavoriteEntryById(favoriteId);
    if (!entry) return false;
    const updatedTorrentData = { ...entry.torrentData, Magnet: magnetLink };
    const res = await this.coll().updateOne(
      { _id: favoriteId },
      { $set: { magnet_link: magnetLink, torrent_data: JSON.stringify(updatedTorrentData), updated_at: nowSec() } }
    );
    await this._mirrorById(favoriteId);
    return res.modifiedCount > 0;
  }

  async getOrCreateFavoriteEntry(torrent, userId = null) {
    let entry = await this.getFavoriteEntry(torrent, userId);
    if (!entry) {
      const favoriteId = await this.createFavoriteEntry(torrent, null, userId);
      if (favoriteId) entry = await this.getFavoriteEntryById(favoriteId);
    }
    return entry;
  }

  async getStats() {
    const count = await this.coll().countDocuments({});
    return { favoriteEntries: count, total: count };
  }

  async getAllFavoritesForStreamRefresh() {
    const rows = await this.coll().find({}).sort({ created_at: -1 }).toArray();
    const seen = new Set();
    const userFavorites = {};
    for (const row of rows) {
      let magnet = row.magnet_link;
      let name = row.torrent_name;
      if (!magnet || !name) {
        try {
          const td = JSON.parse(row.torrent_data);
          magnet = magnet || td.Magnet;
          name = name || td.Name;
        } catch (_) { /* ignore */ }
      }
      if (!magnet) continue;
      const dedupeKey = `${row.user_id || 'anonymous'}::${magnet}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const userId = row.user_id || 'anonymous';
      if (!userFavorites[userId]) userFavorites[userId] = [];
      userFavorites[userId].push({ id: row.id, magnetLink: magnet, torrentName: name || 'Unknown' });
    }
    return Object.entries(userFavorites).map(([userId, favorites]) => ({
      userId: userId === 'anonymous' ? null : userId,
      favorites,
    }));
  }

  async getFavoritesWithMagnetLinksCount() {
    return this.coll().countDocuments({ magnet_link: { $nin: [null, ''] } });
  }

  async addFavorite(torrent, userId = null) {
    const entry = await this.getOrCreateFavoriteEntry(torrent, userId);
    return !!entry;
  }

  async removeFavorite(torrent, userId = null) {
    const torrentKey = this.generateTorrentKey(torrent);
    const res = await this.coll().deleteOne({ torrent_key: torrentKey, user_id: userId });
    await this.mirror.delete('favorite_entries', { torrent_key: torrentKey, user_id: userId });
    return res.deletedCount > 0;
  }
}

// ── Torrent details ───────────────────────────────────────────────────────────

class MongoTorrentDetailsRepository extends MongoBase {
  constructor(mongo, mirror) { super(mongo, mirror, 'torrent_details'); }

  _idFor(favoriteId, source) { return `${favoriteId}::${source}`; }

  _map(row) {
    return {
      id: row.id,
      favoriteEntryId: row.favorite_entry_id,
      source: row.source,
      detailsUrl: row.details_url,
      description: row.description,
      files: row.files ? JSON.parse(row.files) : [],
      comments: row.comments ? JSON.parse(row.comments) : [],
      images: row.images ? JSON.parse(row.images) : [],
      coverImageUrl: row.cover_image_url,
      error: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async setTorrentDetails(favoriteId, source, detailsData) {
    const doc = {
      _id: this._idFor(favoriteId, source),
      favorite_entry_id: favoriteId,
      source,
      details_url: detailsData.detailsUrl || null,
      description: detailsData.description || null,
      files: detailsData.files ? JSON.stringify(detailsData.files) : null,
      comments: detailsData.comments ? JSON.stringify(detailsData.comments) : null,
      images: detailsData.images ? JSON.stringify(detailsData.images) : null,
      cover_image_url: detailsData.coverImageUrl || null,
      error_message: detailsData.error || null,
      updated_at: nowSec(),
      created_at: nowSec(),
    };
    await this.coll().replaceOne({ _id: doc._id }, doc, { upsert: true });
    await this.mirror.upsert('torrent_details', doc);
    return true;
  }

  async getTorrentDetails(favoriteId, source = null) {
    if (source) {
      const row = await this.coll().findOne({ _id: this._idFor(favoriteId, source) });
      return row ? this._map(row) : null;
    }
    const rows = await this.coll()
      .find({ favorite_entry_id: favoriteId })
      .sort({ updated_at: -1 })
      .toArray();
    return rows.map((r) => this._map(r));
  }

  async updateCoverImage(favoriteId, source, coverImageUrl) {
    const id = this._idFor(favoriteId, source);
    const res = await this.coll().updateOne({ _id: id }, { $set: { cover_image_url: coverImageUrl } });
    await this._mirrorById(id);
    return res.modifiedCount > 0;
  }

  async removeTorrentDetails(favoriteId, source = null) {
    if (source) {
      const res = await this.coll().deleteOne({ _id: this._idFor(favoriteId, source) });
      await this.mirror.delete('torrent_details', { favorite_entry_id: favoriteId, source });
      return res.deletedCount > 0;
    }
    const res = await this.coll().deleteMany({ favorite_entry_id: favoriteId });
    await this.mirror.delete('torrent_details', { favorite_entry_id: favoriteId });
    return res.deletedCount > 0;
  }

  async getStats() {
    return { totalTorrentDetails: await this.coll().countDocuments({}) };
  }
}

// ── Search queries ────────────────────────────────────────────────────────────

class MongoSearchQueryRepository extends MongoBase {
  constructor(mongo, mirror) { super(mongo, mirror, 'search_queries'); }

  _idFor(query, website, category) { return `${query}::${website}::${category}`; }

  async upsert(query, website = 'piratebay', category = '') {
    const normalized = (query || '').toLowerCase().trim();
    if (!normalized) return;
    const w = website || 'piratebay';
    const c = category || '';
    const id = this._idFor(normalized, w, c);
    const now = nowSec();
    await this.coll().updateOne(
      { _id: id },
      {
        $set: { query: normalized, website: w, category: c, last_queried_at: now },
        $inc: { query_count: 1 },
        $setOnInsert: { created_at: now },
      },
      { upsert: true }
    );
    await this._mirrorById(id);
  }

  async getRecentQueries(days = 2) {
    const cutoff = nowSec() - days * 24 * 60 * 60;
    return this.coll()
      .find({ last_queried_at: { $gte: cutoff } })
      .sort({ query_count: -1, last_queried_at: -1 })
      .toArray();
  }

  async deleteOldQueries(days = 2) {
    const cutoff = nowSec() - days * 24 * 60 * 60;
    const res = await this.coll().deleteMany({ last_queried_at: { $lt: cutoff } });
    await this.mirror.run('DELETE FROM search_queries WHERE last_queried_at < ?', [cutoff]);
    return res.deletedCount || 0;
  }

  async getCount() {
    return this.coll().countDocuments({});
  }
}

module.exports = {
  MongoCacheRepository,
  MongoImageRepository,
  MongoStreamUrlRepository,
  MongoCachedLinkRepository,
  MongoFavoriteRepository,
  MongoTorrentDetailsRepository,
  MongoSearchQueryRepository,
};
