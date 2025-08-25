const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

class GoogleImagesService {
  constructor() {
    this.customsearch = null;
    this.searchEngineId =
      process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || '43fbfca60a66d4222';
    this.initializeAuth();
  }

  async initializeAuth() {
    try {
      // Look for service account file
      const serviceAccountPath =
        process.env.GOOGLE_SERVICE_ACCOUNT_PATH ||
        path.join(__dirname, '..', 'tsearch-1756011816802-216637491714.json');

      if (fs.existsSync(serviceAccountPath)) {
        const auth = new google.auth.GoogleAuth({
          keyFile: serviceAccountPath,
          scopes: ['https://www.googleapis.com/auth/cse'],
        });

        this.customsearch = google.customsearch({
          version: 'v1',
          auth: auth,
        });
      } else {
        // Fallback to API key if service account is not available
        const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
        if (apiKey) {
          this.customsearch = google.customsearch({
            version: 'v1',
            auth: apiKey,
          });
        } else {
          return;
        }
      }
    } catch (error) {
      // Failed to initialize Google authentication
    }
  }

  async searchImages(query, limit = 20) {
    if (!this.customsearch) {
      throw new Error('Google Custom Search API not initialized');
    }

    try {
      const cleanedQuery = this.cleanQuery(query);

      return await this.performSearch(cleanedQuery, limit);
    } catch (error) {
      // Check if it's a quota error
      if (
        error.code === 429 ||
        (error.errors && error.errors[0]?.reason === 'quotaExceeded')
      ) {
        throw new Error(
          'Google Custom Search API quota exceeded. Please wait or upgrade your plan.'
        );
      }

      throw new Error(`Image search failed: ${error.message}`);
    }
  }

  async performSearch(query, limit) {
    const allResults = [];
    const maxResultsPerRequest = 10; // Google API limit
    const maxRequests = Math.ceil(Math.min(limit, 100) / maxResultsPerRequest);

    for (let requestIndex = 0; requestIndex < maxRequests; requestIndex++) {
      const startIndex = requestIndex * maxResultsPerRequest + 1;

      try {
        const response = await this.customsearch.cse.list({
          q: query,
          cx: this.searchEngineId,
          searchType: 'image',
          num: maxResultsPerRequest,
          start: startIndex,
          safe: 'off',
          filter: '0',
        });

        if (!response.data.items || response.data.items.length === 0) {
          break;
        }

        const requestResults = response.data.items.map((item, index) => ({
          url: item.link,
          title:
            item.title || `${query} - Image ${allResults.length + index + 1}`,
          thumbnail: item.image?.thumbnailLink || item.link,
          width: item.image?.width || 800,
          height: item.image?.height || 600,
          source: item.displayLink || 'google.com',
        }));

        allResults.push(...requestResults);

        if (allResults.length >= limit) {
          break;
        }

        // Small delay between requests
        if (requestIndex < maxRequests - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        if (requestIndex === 0) {
          throw error;
        } else {
          break;
        }
      }
    }

    return allResults.slice(0, limit);
  }

  cleanQuery(query) {
    // Clean and prepare search query
    let cleanedQuery = query
      .replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i, '')
      .replace(
        /\b(1080p|720p|480p|4k|hd|BluRay|BDRip|HDRip|WEBRip|DVDRip|BrRip)\b/gi,
        ''
      )
      .replace(/\b(x264|x265|HEVC|H\.264|H\.265|AVC|AAC|AC3)\b/gi, '')
      .replace(/\b(P2P|RARBG|YTS|ETRG|WRB)\b/gi, '')
      .replace(/\[\w+\]/g, '')
      .replace(/\(\d{4}\)/g, '')
      .replace(/\b\d{2}\s\d{2}\s\d{2}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return cleanedQuery;
  }

  generateSearchSuggestions(torrentName) {
    const cleaned = this.cleanQuery(torrentName);
    const suggestions = [cleaned];

    const words = cleaned.split(' ').filter((word) => word.length > 0);

    if (words.length >= 2) {
      if (words.length >= 2) {
        suggestions.push(words.slice(0, 2).join(' '));
      }

      if (words.length >= 3) {
        suggestions.push(`${words[0]} ${words.slice(1, 3).join(' ')}`);
        suggestions.push(words.slice(-2).join(' '));
      }

      if (words.length >= 2) {
        suggestions.push(words[1]);
        if (words.length >= 3) {
          suggestions.push(words[2]);
        }
      }
    }

    suggestions.push(`${cleaned} photo`);
    suggestions.push(`${cleaned} image`);
    suggestions.push(`${cleaned} gallery`);

    return Array.from(new Set(suggestions.filter((s) => s.length > 0)));
  }
}

module.exports = new GoogleImagesService();
