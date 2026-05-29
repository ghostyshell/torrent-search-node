/**
 * Multi-Host Image Upload Service
 *
 * Uploads images to multiple free adult-friendly hosts in parallel.
 * Stored as fallback_urls so the UI can cycle through them when the
 * primary host (Pixhost) is blocked or unreachable.
 */

const FormData = require('form-data');
const fetch = require('node-fetch');

const HOSTS = ['postimage', 'fastpic'];

// ── PostImage ─────────────────────────────────────────────────────────────────

async function uploadToPostimage(imageBuffer) {
  const form = new FormData();
  form.append('img', imageBuffer, {
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

// ── Fastpic ───────────────────────────────────────────────────────────────────

async function uploadToFastpic(imageBuffer) {
  const form = new FormData();
  form.append('uploading', '1');
  form.append('file1', imageBuffer, {
    filename: 'image.jpg',
    contentType: 'image/jpeg',
  });

  const response = await fetch('https://fastpic.org/upload?api=1', {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json', ...form.getHeaders() },
    timeout: 60000,
  });

  if (!response.ok) {
    throw new Error(`Fastpic API error: ${response.status}`);
  }

  const result = await response.json();
  const url = result.image_url || result.fullsize || result.link;
  if (!url) {
    throw new Error('Fastpic: no image URL in response');
  }

  return url;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const UPLOADERS = {
  postimage: uploadToPostimage,
  fastpic: uploadToFastpic,
};

/**
 * Upload an image buffer to all configured hosts in parallel.
 * Returns an array of { host, url } for every host that succeeded.
 * Never throws — failed uploads are silently omitted.
 *
 * @param {Buffer} imageBuffer
 * @returns {Promise<Array<{host:string, url:string}>>}
 */
async function uploadToAllHosts(imageBuffer) {
  const results = await Promise.allSettled(
    HOSTS.map(async (host) => {
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
