const logger = require('../middleware/logger');
const fetch = require('node-fetch');

/**
 * Service to refresh stream URLs for favorites via Real-Debrid API
 */
class StreamUrlRefreshService {
  constructor(storageProvider, authService) {
    this.storage = storageProvider;
    this.authService = authService;
  }

  /**
   * Extract magnet hash from magnet link
   */
  extractMagnetHash(magnetLink) {
    if (!magnetLink) return null;
    const match = magnetLink.match(/btih:([a-fA-F0-9]+)/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Check if filename is a video file
   */
  isVideoFile(filename) {
    const videoExtensions = [
      '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
      '.m4v', '.3gp', '.mpg', '.mpeg', '.ogv', '.ts', '.m2ts'
    ];
    const lowerName = filename.toLowerCase();
    return videoExtensions.some(ext => lowerName.endsWith(ext));
  }

  /**
   * Get the largest video file from torrent files
   */
  getLargestVideoFile(files) {
    const videoFiles = files.filter(file => this.isVideoFile(file.path));
    if (videoFiles.length === 0) return null;
    return videoFiles.reduce((largest, current) =>
      current.bytes > largest.bytes ? current : largest
    );
  }

  /**
   * Check if host supports range requests
   */
  checkRangeRequestSupport(host) {
    const supportedHosts = ['real-debrid.com', 'rdeb.io', 'rdb.io'];
    return supportedHosts.some(supported =>
      host.toLowerCase().includes(supported.toLowerCase())
    );
  }

  /**
   * Refresh stream URLs for all favorites
   * @returns {Promise<object>} Results summary
   */
  async refreshAllFavoriteStreamUrls() {
    const startTime = Date.now();
    const results = {
      totalFavorites: 0,
      usersProcessed: 0,
      refreshed: 0,
      retriedSuccesses: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    try {
      logger.info('🔄 [Stream Refresh] Starting stream URL refresh job');

      // Debug: Check what's in the favorites tables
      const debugStats = await this.storage.favorites.getStats();
      logger.info('📊 [Stream Refresh] Favorites table stats', debugStats);

      // Get all favorites grouped by user
      const userFavorites = await this.storage.favorites.getAllFavoritesForStreamRefresh();

      logger.info('👥 [Stream Refresh] Loaded user favorites', {
        totalUsers: userFavorites?.length || 0,
        totalFavoritesAcrossUsers: userFavorites?.reduce((sum, uf) => sum + uf.favorites.length, 0) || 0
      });

      if (!userFavorites || userFavorites.length === 0) {
        logger.info('⚠️ [Stream Refresh] No favorites with magnet links found for stream refresh');
        return results;
      }

      for (let userIndex = 0; userIndex < userFavorites.length; userIndex++) {
        const { userId, favorites } = userFavorites[userIndex];
        results.totalFavorites += favorites.length;

        logger.info(`👤 [Stream Refresh] Processing user ${userIndex + 1}/${userFavorites.length}`, {
          userId: userId ? userId.substring(0, 8) + '...' : 'anonymous',
          favoritesCount: favorites.length
        });

        // Skip anonymous users (no API key)
        if (!userId) {
          logger.info(`⏭️ [Stream Refresh] Skipping anonymous user (${favorites.length} favorites)`);
          results.skipped += favorites.length;
          continue;
        }

        // Get user's Real-Debrid API key
        const apiKey = await this.authService.getRealDebridApiKey(userId);
        if (!apiKey) {
          logger.info(`⏭️ [Stream Refresh] User has no Real-Debrid API key, skipping ${favorites.length} favorites`);
          results.skipped += favorites.length;
          continue;
        }

        // Decrypt API key if needed
        let decryptedKey = apiKey;
        if (this.authService.decryptApiKey) {
          try {
            decryptedKey = this.authService.decryptApiKey(apiKey);
          } catch (decryptErr) {
            logger.warn('❌ [Stream Refresh] Failed to decrypt API key, skipping user', { error: decryptErr.message });
            results.skipped += favorites.length;
            continue;
          }
        }

        results.usersProcessed++;

        // Process each favorite for this user
        for (let favIndex = 0; favIndex < favorites.length; favIndex++) {
          const favorite = favorites[favIndex];
          const torrentName = favorite.torrentName || 'Unknown';
          const shortName = torrentName.length > 50 ? torrentName.substring(0, 50) + '...' : torrentName;

          logger.info(`🎬 [Stream Refresh] Processing favorite ${favIndex + 1}/${favorites.length}: ${shortName}`);

          try {
            const result = await this.refreshStreamUrl(favorite.magnetLink, decryptedKey, favorite.torrentName);
            if (result.success) {
              results.refreshed++;
              if (result.retriedSuccess) {
                results.retriedSuccesses++;
                logger.info(`✅ [Stream Refresh] Successfully refreshed (after retry): ${shortName}`);
              } else {
                logger.info(`✅ [Stream Refresh] Successfully refreshed: ${shortName}`);
              }
            } else if (result.skipped) {
              results.skipped++;
              logger.info(`⏭️ [Stream Refresh] Skipped: ${shortName} - ${result.reason || 'Unknown reason'}`);
            } else {
              results.failed++;
              logger.warn(`❌ [Stream Refresh] Failed: ${shortName} - ${result.error || 'Unknown error'}`);
              if (result.error) {
                results.errors.push({
                  torrentName: favorite.torrentName,
                  error: result.error,
                });
              }
            }

            // Rate limit: wait between requests to avoid hitting API limits
            await this.sleep(1000);
          } catch (err) {
            results.failed++;
            logger.error(`❌ [Stream Refresh] Exception: ${shortName}`, { error: err.message });
            results.errors.push({
              torrentName: favorite.torrentName,
              error: err.message,
            });
          }
        }

        logger.info(`✅ [Stream Refresh] Completed user ${userIndex + 1}/${userFavorites.length}`, {
          userRefreshed: favorites.length
        });
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info('🎉 [Stream Refresh] Job completed', {
        duration: `${duration}s`,
        totalFavorites: results.totalFavorites,
        usersProcessed: results.usersProcessed,
        refreshed: results.refreshed,
        retriedSuccesses: results.retriedSuccesses,
        skipped: results.skipped,
        failed: results.failed
      });

      return results;
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.error(`❌ [Stream Refresh] Job failed after ${duration}s`, { error: error.message });
      results.errors.push({ error: error.message });
      return results;
    }
  }

  /**
   * Check if an error is transient and worth retrying
   */
  isTransientError(error) {
    if (!error) return false;
    const transientPatterns = [
      'API error: 5', // 5xx server errors
      'API error: 429', // rate limit
      'timeout',
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'socket hang up',
      'network',
      'No download links available',
      'Failed to unrestrict link',
      'No files found in torrent',
      'Magnet error',
    ];
    const lowerError = error.toLowerCase();
    return transientPatterns.some(p => lowerError.includes(p.toLowerCase()));
  }

  /**
   * Refresh stream URL for a single magnet link with automatic retry on transient failures.
   * Strategy:
   *   Attempt 1: Try the normal flow (add magnet, select files, get links).
   *   Attempt 2+: Delete the stale torrent by ID (from previous attempt) AND
   *               by hash search, then re-add from scratch.
   */
  async refreshStreamUrl(magnetLink, apiKey, torrentName) {
    const maxRetries = 3;
    let lastResult = null;
    let lastTorrentId = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      lastResult = await this._attemptRefreshStreamUrl(magnetLink, apiKey, torrentName, attempt, lastTorrentId);

      if (lastResult.success || lastResult.skipped) {
        if (attempt > 1) {
          lastResult.retriedSuccess = true;
          logger.error(`  ↳ Succeeded on retry attempt ${attempt}/${maxRetries}`);
        }
        return lastResult;
      }

      // Capture the torrent ID from the failed attempt for targeted deletion
      if (lastResult._torrentId) {
        lastTorrentId = lastResult._torrentId;
      }

      const errorMsg = lastResult.error || '';
      if (!this.isTransientError(errorMsg)) {
        logger.error(`  ↳ Non-retryable error, giving up: ${errorMsg}`);
        return lastResult;
      }

      if (attempt < maxRetries) {
        const backoffMs = attempt * 5000;
        logger.error(`  ↳ Transient failure (attempt ${attempt}/${maxRetries}), retrying in ${backoffMs / 1000}s: ${errorMsg}`);
        await this.sleep(backoffMs);
      } else {
        logger.error(`  ↳ All ${maxRetries} attempts failed: ${errorMsg}`);
      }
    }

    return lastResult;
  }

  /**
   * Delete a torrent from Real-Debrid by its ID
   */
  async deleteTorrent(torrentId, apiKey) {
    try {
      await this.realDebridRequest('DELETE', `/torrents/delete/${torrentId}`, apiKey);
      logger.error(`  ↳ Deleted torrent ${torrentId} from Real-Debrid`);
      return true;
    } catch (err) {
      logger.error(`  ↳ Failed to delete torrent ${torrentId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Single attempt to refresh stream URL for a magnet link.
   * On retry attempts, deletes the stale torrent (by ID from previous failure
   * and by hash search) so Real-Debrid processes it from scratch.
   */
  async _attemptRefreshStreamUrl(magnetLink, apiKey, torrentName, attempt, previousTorrentId) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    if (!magnetHash) {
      return { success: false, error: 'Invalid magnet link' };
    }

    const log = attempt > 1 ? logger.error.bind(logger) : logger.warn.bind(logger);

    try {
      // On retries, aggressively clean up the stale torrent before re-adding
      if (attempt > 1) {
        log(`  ↳ [Attempt ${attempt}] Cleaning up stale torrent before retry...`);

        // 1) Delete by the exact ID from the previous failed attempt (most reliable)
        if (previousTorrentId) {
          log(`  ↳ [Attempt ${attempt}] Deleting previous torrent by ID: ${previousTorrentId}`);
          await this.deleteTorrent(previousTorrentId, apiKey);
        }

        // 2) Also search by hash in case addMagnet returned a different stale entry
        await this._deleteExistingTorrentByHash(magnetHash, apiKey);

        // Give RD time to fully purge the torrent before re-adding
        await this.sleep(2000);
      }

      // Step 1: Add magnet to Real-Debrid
      log(`  ↳ [Attempt ${attempt}] Adding magnet to Real-Debrid...`);
      const addResponse = await this.realDebridRequest('POST', '/torrents/addMagnet', apiKey, {
        magnet: magnetLink,
      });

      if (!addResponse.id) {
        return { success: false, error: 'Failed to add magnet to Real-Debrid' };
      }

      const torrentId = addResponse.id;
      log(`  ↳ [Attempt ${attempt}] Magnet added, torrent ID: ${torrentId}`);

      // Wait for torrent to be processed, longer on retries
      const processWait = 2000 + (attempt - 1) * 2000;
      await this.sleep(processWait);

      // Step 2: Get torrent info
      const infoResponse = await this.realDebridRequest('GET', `/torrents/info/${torrentId}`, apiKey);
      log(`  ↳ [Attempt ${attempt}] Torrent status: ${infoResponse?.status}, files: ${infoResponse?.files?.length || 0}`);

      if (!infoResponse || infoResponse.status === 'magnet_error') {
        return { success: false, error: 'Magnet error', _torrentId: torrentId };
      }

      if (!infoResponse.files || infoResponse.files.length === 0) {
        return { success: false, error: 'No files found in torrent', _torrentId: torrentId };
      }

      // Step 3: Find the largest video file
      const videoFile = this.getLargestVideoFile(infoResponse.files);
      if (!videoFile) {
        return { success: false, error: 'No video files found in torrent' };
      }

      log(`  ↳ [Attempt ${attempt}] Selected video: ${videoFile.path} (${(videoFile.bytes / 1024 / 1024).toFixed(0)}MB)`);

      // Always call selectFiles unconditionally (matching frontend regenerate behavior)
      log(`  ↳ [Attempt ${attempt}] Selecting file (torrent status: ${infoResponse.status})...`);
      await this.realDebridRequest('POST', `/torrents/selectFiles/${torrentId}`, apiKey, {
        files: videoFile.id.toString(),
      });

      // Step 4: Poll torrent info until links appear or timeout
      // RD torrents go through: waiting_files_selection → queued → downloading → downloaded
      // A single check often catches a transient state; polling is more reliable
      const pollInterval = 3000;
      const maxPollTime = 30000;
      const pollStart = Date.now();
      let updatedInfo = null;

      while (Date.now() - pollStart < maxPollTime) {
        await this.sleep(pollInterval);
        updatedInfo = await this.realDebridRequest('GET', `/torrents/info/${torrentId}`, apiKey);
        const elapsed = ((Date.now() - pollStart) / 1000).toFixed(0);
        log(`  ↳ [Attempt ${attempt}] Poll ${elapsed}s - status: ${updatedInfo?.status}, links: ${updatedInfo?.links?.length || 0}`);

        if (updatedInfo.links && updatedInfo.links.length > 0) {
          break;
        }

        // If status is 'downloaded' but no links, something is wrong -- stop polling
        if (updatedInfo.status === 'downloaded' && (!updatedInfo.links || updatedInfo.links.length === 0)) {
          break;
        }

        // 'magnet_error' is permanent
        if (updatedInfo.status === 'magnet_error') {
          break;
        }
      }

      if (!updatedInfo || !updatedInfo.links || updatedInfo.links.length === 0) {
        const elapsed = ((Date.now() - pollStart) / 1000).toFixed(0);
        log(`  ↳ [Attempt ${attempt}] No links after ${elapsed}s polling (final status: ${updatedInfo?.status})`);
        return {
          success: false,
          error: `No download links available after ${elapsed}s. Torrent status: ${updatedInfo?.status || 'unknown'}.`,
          _torrentId: torrentId,
        };
      }

      // Step 5: Unrestrict the first available link
      log(`  ↳ [Attempt ${attempt}] Unrestricting link...`);
      return await this.unrestrictAndCache(updatedInfo.links[0], apiKey, magnetLink, torrentName);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Find and delete existing torrents by info-hash.
   * Fetches multiple pages from /torrents to handle large libraries.
   */
  async _deleteExistingTorrentByHash(magnetHash, apiKey) {
    try {
      // Fetch up to 100 recent torrents (RD default page is 50, limit param goes up to 100)
      const torrents = await this.realDebridRequest('GET', '/torrents?limit=100', apiKey);
      if (!Array.isArray(torrents)) return;

      const matches = torrents.filter(t =>
        t.hash && t.hash.toLowerCase() === magnetHash.toLowerCase()
      );

      if (matches.length === 0) {
        logger.error(`  ↳ No existing torrent found for hash ${magnetHash.substring(0, 12)}...`);
        return;
      }

      for (const match of matches) {
        logger.error(`  ↳ Found stale torrent ${match.id} (status: ${match.status}), deleting...`);
        await this.deleteTorrent(match.id, apiKey);
      }
    } catch (err) {
      logger.error(`  ↳ Could not look up existing torrents: ${err.message}`);
    }
  }

  /**
   * Unrestrict link and cache the stream URL
   */
  async unrestrictAndCache(link, apiKey, magnetLink, torrentName) {
    try {
      // Unrestrict the link
      const unrestrictResponse = await this.realDebridRequest('POST', '/unrestrict/link', apiKey, {
        link: link,
      });

      if (!unrestrictResponse.download) {
        return { success: false, error: 'Failed to unrestrict link' };
      }

      // Check range request support based on host (like frontend)
      const supportsRangeRequests = this.checkRangeRequestSupport(unrestrictResponse.host || '');

      // Cache the stream URL
      await this.storage.setStreamUrl(magnetLink, {
        streamUrl: unrestrictResponse.download,
        filename: unrestrictResponse.filename || torrentName,
        filesize: unrestrictResponse.filesize || 0,
        supportsRangeRequests,
        torrentName: torrentName,
      });

      logger.debug('Stream URL refreshed', { torrentName, supportsRangeRequests });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Make a request to Real-Debrid API
   */
  async realDebridRequest(method, endpoint, apiKey, data = null) {
    const url = `https://api.real-debrid.com/rest/1.0${endpoint}`;

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30000,
    };

    if (data && method === 'POST') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(data)) {
        params.append(key, value);
      }
      options.body = params.toString();
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Real-Debrid API error: ${response.status} - ${errorText}`);
    }

    const text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = StreamUrlRefreshService;
