/**
 * Multi-Host Image Upload Service
 *
 * Uploads images to multiple free adult-friendly hosts in parallel.
 * Stored as fallback_urls so the UI can cycle through them when the
 * primary host (Pixhost) is blocked or unreachable.
 */

const FormData = require('form-data');
const fetch = require('node-fetch');

// Backup image hosts, in priority order. Each requires an API key (see
// HOST_KEYS); a host is skipped unless its key is configured.
const HOSTS = ['imgbb', 'postimage'];

// Env var holding each host's API key.
const HOST_KEYS = {
  imgbb: 'IMGBB_API_KEY',
  postimage: 'POSTIMAGES_API_KEY',
};

// ── imgbb ─────────────────────────────────────────────────────────────────────

async function uploadToImgbb(imageBuffer) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    throw new Error('imgbb: IMGBB_API_KEY not configured');
  }

  // imgbb accepts the image as a base64 string and the key as a query param.
  const form = new FormData();
  form.append('image', imageBuffer.toString('base64'));

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      body: form,
      headers: { Accept: 'application/json', ...form.getHeaders() },
      timeout: 60000,
    }
  );

  if (!response.ok) {
    throw new Error(`imgbb API error: ${response.status}`);
  }

  const result = await response.json();
  // result.data.url is the direct, hotlinkable i.ibb.co URL.
  const url = result?.data?.url || result?.data?.display_url || result?.data?.image?.url;
  if (!result?.success || !url) {
    throw new Error('imgbb: no URL in response');
  }

  return url;
}

// ── PostImage ─────────────────────────────────────────────────────────────────

async function uploadToPostimage(imageBuffer) {
  // The PostImages API returns an empty HTML body unless called with a
  // registered API key, so it is skipped entirely (see getActiveHosts) until
  // POSTIMAGES_API_KEY is configured.
  const apiKey = process.env.POSTIMAGES_API_KEY;
  if (!apiKey) {
    throw new Error('PostImage: POSTIMAGES_API_KEY not configured');
  }

  const form = new FormData();
  form.append('key', apiKey);
  form.append('image', imageBuffer, {
    filename: 'image.jpg',
    contentType: 'image/jpeg',
  });
  form.append('adult', '1');
  form.append('format', 'json');

  const response = await fetch('https://api.postimages.org/1/upload', {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json', ...form.getHeaders() },
    timeout: 60000,
  });

  if (!response.ok) {
    throw new Error(`PostImage API error: ${response.status}`);
  }

  const result = await response.json();

  if (!result.direct_link && !result.link) {
    throw new Error('PostImage: no link in response');
  }

  return result.direct_link || result.link;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const UPLOADERS = {
  imgbb: uploadToImgbb,
  postimage: uploadToPostimage,
};

/**
 * Upload an image buffer to all configured hosts in parallel.
 * Returns an array of { host, url } for every host that succeeded.
 * Never throws — failed uploads are silently omitted.
 *
 * @param {Buffer} imageBuffer
 * @returns {Promise<Array<{host:string, url:string}>>}
 */
function getActiveHosts() {
  // Skip any host whose API key isn't configured so we don't fire doomed
  // requests for every image.
  return HOSTS.filter((host) => {
    const keyVar = HOST_KEYS[host];
    return !keyVar || !!process.env[keyVar];
  });
}

async function uploadToAllHosts(imageBuffer) {
  const results = await Promise.allSettled(
    getActiveHosts().map(async (host) => {
      const url = await UPLOADERS[host](imageBuffer);
      return { host, url };
    })
  );

  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
}

/**
 * Fetch an image from a URL and upload to all hosts.
 * Returns [] on fetch failure.
 *
 * @param {string} imageUrl
 * @returns {Promise<Array<{host:string, url:string}>>}
 */
async function uploadFromUrlToAllHosts(imageUrl) {
  try {
    const response = await fetch(imageUrl, {
      timeout: 30000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/*,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      return [];
    }

    const buffer = await response.buffer();
    return uploadToAllHosts(buffer);
  } catch {
    return [];
  }
}

module.exports = { uploadToAllHosts, uploadFromUrlToAllHosts, HOSTS };
