/**
 * Pixhost Upload Service
 *
 * This service provides functionality to upload images to Pixhost
 * and retrieve the hosted URLs for storage in the database.
 */

const FormData = require('form-data');
const fetch = require('node-fetch');

class PixhostService {
  constructor() {
    this.apiUrl = 'https://api.pixhost.to/images';
    this.uploadCache = new Map(); // Cache to avoid duplicate uploads
  }

  /**
   * Upload image to Pixhost from URL
   * @param {string} imageUrl - URL of the image to upload
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result with Pixhost URLs
   */
  async uploadFromUrl(imageUrl, options = {}) {
    try {
      // Check cache first to avoid duplicate uploads
      const cacheKey = this.getCacheKey(imageUrl);
      if (this.uploadCache.has(cacheKey)) {
        const cached = this.uploadCache.get(cacheKey);

        return cached;
      }

      // Fetch the image
      const response = await fetch(imageUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }

      const imageBuffer = await response.buffer();

      // Upload to Pixhost
      const result = await this.uploadBuffer(imageBuffer, options);

      // Cache the result
      this.uploadCache.set(cacheKey, result);

      // Clean cache if it gets too large
      if (this.uploadCache.size > 1000) {
        const keysToDelete = Array.from(this.uploadCache.keys()).slice(0, 100);
        keysToDelete.forEach(key => this.uploadCache.delete(key));
      }

      return result;

    } catch (error) {
      // Only log non-network errors to avoid spam from DNS/connectivity issues
      if (!error.message.includes('ENOTFOUND') &&
          !error.message.includes('EAI_AGAIN') &&
          !error.message.includes('ECONNREFUSED') &&
          !error.message.includes('ETIMEDOUT')) {
        console.error(`❌ [PixhostService] Upload failed for ${imageUrl}:`, error.message);
      }
      throw error;
    }
  }

  /**
   * Upload image buffer to Pixhost
   * @param {Buffer} imageBuffer - Image buffer data
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result with Pixhost URLs
   */
  async uploadBuffer(imageBuffer, options = {}) {
    const form = new FormData();

    form.append('img', imageBuffer, {
      filename: options.filename || 'image.jpg',
      contentType: options.contentType || 'image/jpeg',
    });

    form.append('content_type', options.isAdult === false ? '0' : '1'); // Default to adult (1) to prevent removal
    form.append('max_th_size', options.thumbnailSize || '420');

    const pixhostResponse = await fetch(this.apiUrl, {
      method: 'POST',
      body: form,
      headers: {
        'Accept': 'application/json',
        ...form.getHeaders(),
      },
      timeout: 60000, // 60 second timeout for uploads
    });

    if (!pixhostResponse.ok) {
      const errorText = await pixhostResponse.text();
      throw new Error(`Pixhost API error: ${pixhostResponse.status} ${errorText}`);
    }

    const result = await pixhostResponse.json();

    if (!result.show_url) {
      throw new Error('Invalid response from Pixhost API - no show_url returned');
    }

    // Convert show URL to direct image URL
    // Extract subdomain number from thumbnail URL (e.g., t80.pixhost.to -> 80)
    let directImageUrl;
    if (result.th_url) {
      const thMatch = result.th_url.match(/t(\d+)\.pixhost\.to/);
      if (thMatch) {
        const subdomainNum = thMatch[1];
        directImageUrl = result.show_url.replace(
          'https://pixhost.to/show/',
          `https://img${subdomainNum}.pixhost.to/images/`
        );
      } else {
        directImageUrl = result.show_url.replace(
          'https://pixhost.to/show/',
          'https://img1.pixhost.to/images/'
        );
      }
    } else {
      directImageUrl = result.show_url.replace(
        'https://pixhost.to/show/',
        'https://img1.pixhost.to/images/'
      );
    }

    return {
      originalUrl: null, // Will be set by caller if needed
      pixhostUrl: directImageUrl,
      pixhostShowUrl: result.show_url,
      thumbnailUrl: result.th_url,
      directImageUrl: directImageUrl, // Alias for compatibility
    };
  }

  /**
   * Generate cache key for image URL
   * @param {string} imageUrl - Image URL
   * @returns {string} Cache key
   */
  getCacheKey(imageUrl) {
    // Use a simple hash of the URL for caching
    return Buffer.from(imageUrl).toString('base64').slice(0, 40);
  }

  /**
   * Check if an image is already uploaded to Pixhost
   * @param {string} imageUrl - Image URL to check
   * @returns {string|null} Cached Pixhost URL if available
   */
  getCachedPixhostUrl(imageUrl) {
    const cacheKey = this.getCacheKey(imageUrl);
    const cached = this.uploadCache.get(cacheKey);
    return cached ? cached.directImageUrl : null;
  }

  /**
   * Clear upload cache
   */
  clearCache() {
    this.uploadCache.clear();

  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.uploadCache.size,
      keys: Array.from(this.uploadCache.keys()).slice(0, 10), // Show first 10 keys
    };
  }
}

// Export singleton instance
const pixhostService = new PixhostService();

// Development tools
if (process.env.NODE_ENV === 'development') {
  global.pixhostService = {
    uploadFromUrl: (url) => pixhostService.uploadFromUrl(url),
    getCachedPixhostUrl: (url) => pixhostService.getCachedPixhostUrl(url),
    clearCache: () => pixhostService.clearCache(),
    getCacheStats: () => pixhostService.getCacheStats(),
  };

}

module.exports = pixhostService;