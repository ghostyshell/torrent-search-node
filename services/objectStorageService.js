/**
 * Object Storage Service (Sliplane S3-compatible bucket)
 *
 * Stores backup copies of cover images in a Sliplane object-storage bucket and
 * returns their public URLs, used as fallback_urls when Pixhost is unreachable.
 *
 * Configuration (env):
 *   S3_ENDPOINT           S3-compatible endpoint URL (from the Sliplane dashboard)
 *   S3_REGION             Bucket region: "ger" or "us-east"
 *   S3_BUCKET             Bucket name
 *   S3_ACCESS_KEY_ID      Access key id  (the "client id")
 *   S3_SECRET_ACCESS_KEY  Secret access key (the "secret")
 *   S3_PUBLIC_BASE_URL    (optional) Public base URL for objects. Defaults to
 *                         `${S3_ENDPOINT}/${S3_BUCKET}`.
 *   S3_OBJECT_ACL         (optional) e.g. "public-read" if the bucket requires a
 *                         per-object ACL instead of a public bucket policy.
 *   S3_KEY_PREFIX         (optional) key prefix, default "covers".
 *   S3_TEMP_EXPIRE_DAYS   (optional) days before non-favorite covers expire,
 *                         default 30.
 */

const {
  S3Client,
  PutObjectCommand,
  PutBucketLifecycleConfigurationCommand,
} = require('@aws-sdk/client-s3');
const fetch = require('node-fetch');

const ENDPOINT = process.env.S3_ENDPOINT;
const REGION = process.env.S3_REGION || 'us-east';
const BUCKET = process.env.S3_BUCKET;
const ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const PUBLIC_BASE_URL = (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const OBJECT_ACL = process.env.S3_OBJECT_ACL || undefined;
const KEY_PREFIX = (process.env.S3_KEY_PREFIX || 'covers').replace(/^\/+|\/+$/g, '');
const TEMP_EXPIRE_DAYS = parseInt(process.env.S3_TEMP_EXPIRE_DAYS || '30', 10);

let client = null;
let lifecycleEnsured = false;

function isEnabled() {
  return !!(ENDPOINT && BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

function getClient() {
  if (!client) {
    client = new S3Client({
      endpoint: ENDPOINT,
      region: REGION,
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
      forcePathStyle: true, // required by most S3-compatible providers
    });
  }
  return client;
}

function extForContentType(contentType) {
  if (!contentType) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

/**
 * Object key for a cover. Favorites go under a "keep" prefix (never expire);
 * everything else under "temp" (expired by the lifecycle rule).
 */
function coverKey(torrentKey, isFavorite, contentType) {
  const bucketDir = isFavorite ? 'keep' : 'temp';
  const ext = extForContentType(contentType);
  return `${KEY_PREFIX}/${bucketDir}/${torrentKey}.${ext}`;
}

function publicUrlForKey(key) {
  const base = PUBLIC_BASE_URL || `${(ENDPOINT || '').replace(/\/+$/, '')}/${BUCKET}`;
  return `${base}/${key}`;
}

/**
 * Upload a cover image buffer and return its public URL.
 *
 * @param {object} opts
 * @param {string} opts.torrentKey
 * @param {Buffer} opts.buffer
 * @param {string} [opts.contentType]
 * @param {boolean} [opts.isFavorite]
 * @returns {Promise<string>} public URL of the stored object
 */
async function uploadCoverImage({ torrentKey, buffer, contentType = 'image/jpeg', isFavorite = false }) {
  if (!isEnabled()) {
    throw new Error('object storage not configured (set S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)');
  }

  const key = coverKey(torrentKey, isFavorite, contentType);

  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
      ...(OBJECT_ACL ? { ACL: OBJECT_ACL } : {}),
    })
  );

  return publicUrlForKey(key);
}

/**
 * Fetch an image from a URL and upload it to object storage. Surfaces the
 * failure reason so the migration can record it.
 *
 * @param {object} opts
 * @param {string} opts.torrentKey
 * @param {string} opts.imageUrl   source image URL to copy
 * @param {boolean} [opts.isFavorite]
 * @returns {Promise<{ url: string|null, error: string|null }>}
 */
async function uploadCoverFromUrl({ torrentKey, imageUrl, isFavorite = false }) {
  if (!isEnabled()) {
    return { url: null, error: 'object storage not configured (set S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)' };
  }

  let buffer;
  let contentType;
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
      return { url: null, error: `source fetch HTTP ${response.status}` };
    }
    contentType = response.headers.get('content-type') || 'image/jpeg';
    buffer = await response.buffer();
  } catch (e) {
    return { url: null, error: `source fetch failed: ${e.message}` };
  }

  try {
    const url = await uploadCoverImage({ torrentKey, buffer, contentType, isFavorite });
    return { url, error: null };
  } catch (e) {
    return { url: null, error: `object storage upload failed: ${e.message}` };
  }
}

/**
 * Apply the lifecycle rule that expires non-favorite ("temp") covers after
 * S3_TEMP_EXPIRE_DAYS. Idempotent and best-effort — logs and continues if the
 * provider doesn't support lifecycle configuration.
 */
async function ensureLifecycleRule(logger = console) {
  if (!isEnabled() || lifecycleEnsured) return;
  try {
    await getClient().send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: BUCKET,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire-temp-covers',
              Status: 'Enabled',
              Filter: { Prefix: `${KEY_PREFIX}/temp/` },
              Expiration: { Days: TEMP_EXPIRE_DAYS },
            },
          ],
        },
      })
    );
    lifecycleEnsured = true;
    logger.info?.(`[ObjectStorage] Lifecycle rule set: expire ${KEY_PREFIX}/temp/ after ${TEMP_EXPIRE_DAYS}d`);
  } catch (e) {
    logger.warn?.(`[ObjectStorage] Could not set lifecycle rule (set expiration on ${KEY_PREFIX}/temp/ manually): ${e.message}`);
  }
}

module.exports = {
  isEnabled,
  uploadCoverImage,
  uploadCoverFromUrl,
  ensureLifecycleRule,
  coverKey,
  publicUrlForKey,
  TEMP_EXPIRE_DAYS,
};
