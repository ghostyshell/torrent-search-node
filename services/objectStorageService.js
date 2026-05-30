/**
 * Object Storage Service (Sliplane / S3-compatible bucket)
 *
 * Cover images are stored in the bucket and served to the frontend via
 * **presigned GET URLs** (the bucket is private — anonymous GETs are rejected).
 * Presigned URLs expire (SigV4 max 7 days), so a background job periodically
 * regenerates them, and another removes expired non-favorite objects (the
 * provider has no lifecycle API).
 *
 * Keys:
 *   ${KEY_PREFIX}/keep/<torrentKey>.jpg   favorites — kept indefinitely
 *   ${KEY_PREFIX}/temp/<torrentKey>.jpg   non-favorites — cleaned up after
 *                                         S3_TEMP_EXPIRE_DAYS
 *
 * Configuration (env):
 *   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   S3_KEY_PREFIX        (optional) default "covers"
 *   S3_TEMP_EXPIRE_DAYS  (optional) default 30
 *   S3_PRESIGN_DAYS      (optional) presigned URL validity in days, default 7 (max)
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fetch = require('node-fetch');

const ENDPOINT = process.env.S3_ENDPOINT;
const REGION = process.env.S3_REGION || 'us-east';
const BUCKET = process.env.S3_BUCKET;
const ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const KEY_PREFIX = (process.env.S3_KEY_PREFIX || 'covers').replace(/^\/+|\/+$/g, '');
const TEMP_EXPIRE_DAYS = parseInt(process.env.S3_TEMP_EXPIRE_DAYS || '30', 10);
// SigV4 presigned URLs are valid for at most 7 days.
const PRESIGN_EXPIRES_SECONDS = Math.min(
  parseInt(process.env.S3_PRESIGN_DAYS || '7', 10) * 24 * 3600,
  7 * 24 * 3600
);

const KEEP_PREFIX = `${KEY_PREFIX}/keep/`;
const TEMP_PREFIX = `${KEY_PREFIX}/temp/`;

let client = null;

function isEnabled() {
  return !!(ENDPOINT && BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

function getClient() {
  if (!client) {
    client = new S3Client({
      endpoint: ENDPOINT,
      region: REGION,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
      forcePathStyle: true,
    });
  }
  return client;
}

/**
 * Object key for a cover. Favorites under "keep", others under "temp". A single
 * .jpg extension keeps keys deterministic from the torrent key (the real
 * content-type is stored on the object, which is what browsers use).
 */
function coverKey(torrentKey, isFavorite) {
  return `${isFavorite ? KEEP_PREFIX : TEMP_PREFIX}${torrentKey}.jpg`;
}

/** Upload a cover image buffer; returns the object key. */
async function uploadCover({ torrentKey, buffer, contentType = 'image/jpeg', isFavorite = false }) {
  const key = coverKey(torrentKey, isFavorite);
  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
  return key;
}

/** Generate a presigned GET URL for an object key. */
async function getPresignedUrl(key, expiresIn = PRESIGN_EXPIRES_SECONDS) {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn,
  });
}

/** Whether an object exists in the bucket. */
async function objectExists(key) {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Delete an object. */
async function deleteObject(key) {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/** List objects under a prefix; returns [{ Key, LastModified }]. */
async function listObjects(prefix) {
  const out = [];
  let ContinuationToken;
  do {
    const resp = await getClient().send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken })
    );
    for (const o of resp.Contents || []) {
      out.push({ Key: o.Key, LastModified: o.LastModified });
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

/**
 * Fetch an image from a URL and upload it to object storage. Reuses an existing
 * object (e.g. from an earlier run) without re-downloading. Returns the key.
 *
 * @returns {Promise<{ key: string|null, error: string|null }>}
 */
async function uploadCoverFromUrl({ torrentKey, imageUrl, isFavorite = false }) {
  if (!isEnabled()) {
    return { key: null, error: 'object storage not configured' };
  }

  const key = coverKey(torrentKey, isFavorite);

  // If we already uploaded this object on a previous run, skip the download.
  if (await objectExists(key)) {
    return { key, error: null };
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
      return { key: null, error: `source fetch HTTP ${response.status}` };
    }
    contentType = response.headers.get('content-type') || 'image/jpeg';
    buffer = await response.buffer();
  } catch (e) {
    return { key: null, error: `source fetch failed: ${e.message}` };
  }

  try {
    await uploadCover({ torrentKey, buffer, contentType, isFavorite });
    return { key, error: null };
  } catch (e) {
    return { key: null, error: `object storage upload failed: ${e.message}` };
  }
}

module.exports = {
  isEnabled,
  coverKey,
  uploadCover,
  uploadCoverFromUrl,
  getPresignedUrl,
  objectExists,
  deleteObject,
  listObjects,
  KEY_PREFIX,
  KEEP_PREFIX,
  TEMP_PREFIX,
  TEMP_EXPIRE_DAYS,
  PRESIGN_EXPIRES_SECONDS,
};
