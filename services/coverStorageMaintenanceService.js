/**
 * Cover Storage Maintenance
 *
 * Object-storage cover URLs are presigned and therefore expire, and the
 * provider has no lifecycle API, so two periodic jobs keep things healthy:
 *
 *  - refreshPresignedUrls: regenerate presigned URLs for all stored covers so
 *    they never lapse (presigning is a local operation — no network per URL).
 *  - cleanupExpiredTemp: delete non-favorite ("temp") objects older than
 *    S3_TEMP_EXPIRE_DAYS and their DB rows, so the bucket doesn't grow forever.
 */

const objectStorage = require('./objectStorageService');

async function refreshPresignedUrls(storageProvider, logger = console) {
  if (!objectStorage.isEnabled()) return { skipped: true };

  const PAGE = 200;
  let offset = 0;
  let processed = 0;
  let refreshed = 0;
  let failed = 0;

  while (true) {
    const rows = await storageProvider.images.getObjectStorageCovers(PAGE, offset);
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      try {
        const url = await objectStorage.getPresignedUrl(row.storage_key);
        await storageProvider.images.updateCoverPresignedUrl(row.torrent_key, url);
        refreshed++;
      } catch (e) {
        failed++;
      }
      processed++;
    }

    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  logger.info?.(`[CoverRefresh] refreshed ${refreshed}/${processed} presigned URLs (failed ${failed})`);
  return { processed, refreshed, failed };
}

async function cleanupExpiredTemp(storageProvider, logger = console) {
  if (!objectStorage.isEnabled()) return { skipped: true };

  const cutoff = Date.now() - objectStorage.TEMP_EXPIRE_DAYS * 24 * 3600 * 1000;
  const objects = await objectStorage.listObjects(objectStorage.TEMP_PREFIX);

  let deleted = 0;
  let failed = 0;
  for (const obj of objects) {
    const lastModified = obj.LastModified ? new Date(obj.LastModified).getTime() : 0;
    if (!lastModified || lastModified >= cutoff) continue;
    try {
      await objectStorage.deleteObject(obj.Key);
      await storageProvider.images.deleteCoverByStorageKey(obj.Key);
      deleted++;
    } catch (e) {
      failed++;
    }
  }

  logger.info?.(
    `[CoverCleanup] removed ${deleted} expired non-favorite covers older than ${objectStorage.TEMP_EXPIRE_DAYS}d (of ${objects.length} temp objects, failed ${failed})`
  );
  return { total: objects.length, deleted, failed };
}

module.exports = { refreshPresignedUrls, cleanupExpiredTemp };
