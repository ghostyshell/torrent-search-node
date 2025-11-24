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
   * Refresh stream URLs for all favorites
   * @returns {Promise<object>} Results summary
   */
  async refreshAllFavoriteStreamUrls() {
    const results = {
      totalFavorites: 0,
      usersProcessed: 0,
      refreshed: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    try {
      // Get all favorites grouped by user
      const userFavorites = await this.storage.favorites.getAllFavoritesForStreamRefresh();

      if (!userFavorites || userFavorites.length === 0) {
        logger.info('No favorites with magnet links found for stream refresh');
        return results;
      }

      for (const { userId, favorites } of userFavorites) {
        results.totalFavorites += favorites.length;

        // Skip anonymous users (no API key)
        if (!userId) {
          results.skipped += favorites.length;
          continue;
        }

        // Get user's Real-Debrid API key
        const apiKey = await this.authService.getRealDebridApiKey(userId);
        if (!apiKey) {
          logger.debug('User has no Real-Debrid API key', { userId });
          results.skipped += favorites.length;
          continue;
        }

        // Decrypt API key if needed
        let decryptedKey = apiKey;
        if (this.authService.decryptApiKey) {
          try {
            decryptedKey = this.authService.decryptApiKey(apiKey);
          } catch (decryptErr) {
            logger.warn('Failed to decrypt API key', { userId, error: decryptErr.message });
            results.skipped += favorites.length;
            continue;
          }
        }

        results.usersProcessed++;

        // Process each favorite for this user
        for (const favorite of favorites) {
          try {
            const result = await this.refreshStreamUrl(favorite.magnetLink, decryptedKey, favorite.torrentName);
            if (result.success) {
              results.refreshed++;
            } else if (result.skipped) {
              results.skipped++;
            } else {
              results.failed++;
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
            results.errors.push({
              torrentName: favorite.torrentName,
              error: err.message,
            });
          }
        }
      }

      return results;
    } catch (error) {
      logger.error('Error refreshing favorite stream URLs', { error: error.message });
      results.errors.push({ error: error.message });
      return results;
    }
  }

  /**
   * Refresh stream URL for a single magnet link
   */
  async refreshStreamUrl(magnetLink, apiKey, torrentName) {
    const magnetHash = this.extractMagnetHash(magnetLink);
    if (!magnetHash) {
      return { success: false, error: 'Invalid magnet link' };
    }

    try {
      // Step 1: Add magnet to Real-Debrid
      const addResponse = await this.realDebridRequest('POST', '/torrents/addMagnet', apiKey, {
        magnet: magnetLink,
      });

      if (!addResponse.id) {
        return { success: false, error: 'Failed to add magnet to Real-Debrid' };
      }

      const torrentId = addResponse.id;

      // Step 2: Get torrent info
      const infoResponse = await this.realDebridRequest('GET', `/torrents/info/${torrentId}`, apiKey);

      if (!infoResponse || infoResponse.status === 'magnet_error') {
        return { success: false, error: 'Magnet error' };
      }

      // Step 3: Select files if needed
      if (infoResponse.status === 'waiting_files_selection') {
        // Select all files
        const fileIds = infoResponse.files
          .filter(f => f.selected === 0)
          .map(f => f.id)
          .join(',');

        if (fileIds) {
          await this.realDebridRequest('POST', `/torrents/selectFiles/${torrentId}`, apiKey, {
            files: fileIds || 'all',
          });
        } else {
          await this.realDebridRequest('POST', `/torrents/selectFiles/${torrentId}`, apiKey, {
            files: 'all',
          });
        }

        // Wait for file selection to process
        await this.sleep(2000);

        // Get updated info
        const updatedInfo = await this.realDebridRequest('GET', `/torrents/info/${torrentId}`, apiKey);
        if (updatedInfo && updatedInfo.links && updatedInfo.links.length > 0) {
          return await this.unrestrictAndCache(updatedInfo.links[0], apiKey, magnetLink, torrentName);
        }
      }

      // Step 4: If already has links, unrestrict the first one
      if (infoResponse.links && infoResponse.links.length > 0) {
        return await this.unrestrictAndCache(infoResponse.links[0], apiKey, magnetLink, torrentName);
      }

      return { success: false, error: 'No links available' };
    } catch (error) {
      return { success: false, error: error.message };
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

      // Cache the stream URL
      await this.storage.setStreamUrl(magnetLink, {
        streamUrl: unrestrictResponse.download,
        filename: unrestrictResponse.filename || torrentName,
        filesize: unrestrictResponse.filesize || 0,
        supportsRangeRequests: true,
        torrentName: torrentName,
      });

      logger.debug('Stream URL refreshed', { torrentName });
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
