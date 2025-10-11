const { google } = require('googleapis');

class GoogleImagesService {
  constructor() {
    this.customsearch = null;
    this.searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;
    this.initializeAuth();
  }

  async initializeAuth() {
    try {
      // Required environment variables
      const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const customSearchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;

      if (!serviceAccountJson) {
        console.warn('⚠ Google Images Service: GOOGLE_SERVICE_ACCOUNT_JSON not configured - image search will be unavailable');
        return;
      }

      if (!customSearchEngineId) {
        console.warn('⚠ Google Images Service: GOOGLE_CUSTOM_SEARCH_ENGINE_ID not configured - image search will be unavailable');
        return;
      }

      let credentials;
      try {
        credentials = JSON.parse(serviceAccountJson);
      } catch (parseError) {
        console.warn('⚠ Google Images Service: Invalid GOOGLE_SERVICE_ACCOUNT_JSON format - image search will be unavailable');
        return;
      }

      // Validate required fields in service account JSON
      const requiredFields = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email'];
      const missingFields = requiredFields.filter(field => !credentials[field]);

      if (missingFields.length > 0) {
        console.warn(`⚠ Google Images Service: Missing required fields in service account JSON: ${missingFields.join(', ')} - image search will be unavailable`);
        return;
      }

      const auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cse'],
      });

      this.customsearch = google.customsearch({
        version: 'v1',
        auth: auth,
      });

    } catch (error) {
      console.warn('⚠ Google Images Service initialization failed:', error.message, '- image search will be unavailable');
      this.customsearch = null;
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

// Export the class instead of an instance to allow graceful handling
let instance = null;

function getInstance() {
  if (!instance) {
    try {
      instance = new GoogleImagesService();
    } catch (error) {
      console.warn('⚠ Google Images Service could not be initialized:', error.message);
      instance = {
        searchImages: async () => {
          throw new Error('Google Images Service not available - check environment configuration');
        },
        getSuggestions: async () => {
          throw new Error('Google Images Service not available - check environment configuration');
        }
      };
    }
  }
  return instance;
}

module.exports = getInstance();
