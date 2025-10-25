const axios = require('axios');

// Extract direct image URL from imgur.com
async function getImgurDirectUrl(url) {
  try {
    // Convert imgur.com URLs to i.imgur.com direct URLs
    const imgurId = url.split('/').pop();
    const directUrl = `https://i.imgur.com/${imgurId}.jpg`;

    // Try different extensions
    const extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    for (const ext of extensions) {
      try {
        const testUrl = `https://i.imgur.com/${imgurId}.${ext}`;
        const response = await axios.head(testUrl, { timeout: 5000 });
        if (response.status === 200) {
          return testUrl;
        }
      } catch (e) {
        // Continue to next extension
      }
    }

    return directUrl; // Return default .jpg if none work
  } catch (error) {

    return null;
  }
}

module.exports = getImgurDirectUrl;
