# Caching and Storage

The application uses three storage backends: MongoDB (primary persistent store), Redis (optional catalog pre-cache), and an S3-compatible object store (optional cover image store). This document describes each layer in detail.

---

## MongoDB (Primary Persistent Store)

MongoDB is the mandatory backbone. All user data, session data, cover images, stream URLs, and general cache entries live here.

### Collections

| Collection | Repository class | Purpose |
|---|---|---|
| `cache_entries` | `MongoCacheRepository` | Generic key-value cache with TTL |
| `images` | `MongoImageRepository` | Cover images (binary or S3 key + presigned URL) |
| `stream_urls` | `MongoStreamUrlRepository` | Cached Real-Debrid stream URLs per magnet hash |
| `favorites` | `MongoFavoriteRepository` | User-to-torrent favorite associations |
| `favorite_entries` | `MongoFavoriteRepository` | Full torrent snapshots with magnet links |
| `cached_links` | `MongoCachedLinkRepository` | User-pinned links with metadata |
| `torrent_details` | `MongoTorrentDetailsRepository` | Scraped detail blobs for favorite entries |
| `search_queries` | `MongoSearchQueryRepository` | Distinct (query, website, category) tuples |
| `users` | `MongoAuthStore` | Google OAuth user profiles |
| `sessions` | `MongoAuthStore` | Session tokens with expiry and device metadata |
| `exchange_codes` | `MongoAuthStore` | Single-use SPA auth handoff codes |

### Connection

`database/MongoClient.js` wraps the official `mongodb` driver. The `StorageProvider` is the central coordinator; it calls `MongoClient.initializeConnection()` on startup and exposes all repository instances.

Connection string is built from `MONGODB_URI` (or `MONGO_URL`). If the URI has no embedded credentials and `MONGO_USERNAME` + `MONGO_PASSWORD` are set, they are URL-encoded and injected automatically.

### Cleanup

`MongoCacheRepository.cleanupExpired()` deletes entries whose TTL has elapsed. This is called by the `storageCleanup` background job every 60 minutes.

`MongoStreamUrlRepository.cleanupOldStreamUrls(maxEntries)` keeps only the 100 most recently updated stream URL entries.

---

## Redis (Catalog Pre-Cache)

Redis is optional. When `REDIS_URL` is set, the `RedisCatalogCacheService` pre-populates Redis with normalised torrent lists for the Stremio addon, so the addon can serve catalog responses without hitting the upstream torrent site on every request.

### Key Format

```
cat:v1:{BASE_URL}|{catalogId}|movie||0
```

- `BASE_URL` — the public URL of this API instance (must match what addon users configure as `backendUrl`).
- `catalogId` — encodes the category and sort variant, e.g. `xxx_top`, `xxx_fhd_recent`, `xxx_studio_brazzers_top`.

### Value Format

JSON array of normalised torrent objects:

```json
[
  {
    "title": "...",
    "size": "4.7 GB",
    "seeders": 1200,
    "leechers": 80,
    "infoHash": "abcdef...",
    "magnetLink": "magnet:?xt=...",
    "torrentUrl": "https://...",
    "coverImage": "https://...",
    "website": "hiddenbay",
    "indexer": "hiddenbay",
    "quality": ""
  }
]
```

### TTL

Each Redis key is given a TTL of 1500–2100 seconds (25–35 minutes, with jitter). The background job runs every 25–35 minutes with fresh jitter, so keys are always refreshed before they expire.

### Categories Pre-Cached

- 4K (category `507`) and 1080p (category `505`) — two sort variants each: top (seeders desc) and recent (newest).
- Trans searches — same two sort variants.
- All studios from `config/studioSearchTerms.json` — two sort variants each.

### Jitter

Both the TTL and the job interval use randomised jitter to spread load across multiple instances and avoid simultaneous cache stampedes.

### Client Setup

The Redis client (via `ioredis`) is created lazily on first use. If the connection fails, the job logs a warning and skips — the addon falls back to scraping live data.

---

## S3-Compatible Object Storage (Cover Images)

Cover images can be stored in any S3-compatible bucket (AWS S3, Backblaze B2, Cloudflare R2, etc.). When configured (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` all set), images are uploaded to the bucket instead of stored as binary BLOBs in MongoDB.

### Object Layout

```
{KEY_PREFIX}/
  keep/
    <torrentKey>.jpg    ← favorite covers — kept indefinitely
  temp/
    <torrentKey>.jpg    ← non-favorite covers — cleaned up after S3_TEMP_EXPIRE_DAYS days
```

`torrentKey` is a deterministic hash derived from the torrent's name and source URL, used as a stable identifier across page fetches.

### Presigned URLs

The bucket is private (no anonymous GET access). Every object that is read by the frontend is served via a **presigned GET URL** — a time-limited URL signed with the bucket credentials. Default validity: 7 days (SigV4 maximum).

Presigned URLs are stored alongside the object key in the MongoDB `images` collection so the frontend can retrieve them without generating a new signature on every request.

### Presigned URL Refresh

Because presigned URLs expire, a background job (`coverStorageMaintenanceService`) runs every 5 hours to:
1. Enumerate all image records in MongoDB that have an S3 object key.
2. Re-generate presigned URLs for any that are expiring within a safety window.
3. Update the MongoDB record with the new URL.

### Temp Object Cleanup

The same maintenance job also:
1. Lists all objects under the `temp/` prefix.
2. Deletes objects (and their MongoDB records) older than `S3_TEMP_EXPIRE_DAYS` (default 30 days).
3. Preserves `keep/` objects (favorites) regardless of age.

### Cover Upload Flow

```
imageExtractorService  →  finds candidate image URL(s) from torrent description
        │
        ▼
objectStorageService.uploadCoverFromUrl()
        │
        ├── Check if object already exists (skip re-download)
        │
        ├── Fetch image from source URL
        │
        ├── Upload buffer to S3 under the appropriate prefix
        │
        └── Return object key
        │
        ▼
MongoImageRepository.setCoverImage()
        └── Store { key, presignedUrl, mimeType } in MongoDB
```

---

## Stream URL Caching

Real-Debrid stream URLs are expensive to generate (each call to the Real-Debrid API counts against rate limits). The application caches the resolved stream URL for each magnet link hash in MongoDB (`stream_urls` collection) with a configurable TTL (`STREAM_URL_TTL_SECONDS`, default 20 hours).

### Cache Hit

When a request for a stream URL arrives for a magnet the system has seen before, the cached URL is returned immediately — no Real-Debrid API call needed.

### Cache Miss / Stale

When the cached URL is absent or older than `STREAM_URL_TTL_SECONDS`, the caller is expected to generate a fresh URL via the Real-Debrid API and store it with `streamUrls.setStreamUrl()`.

### Background Refresh

The `streamUrlRefreshService` runs every 24 hours (with a 70-second initial delay) and proactively refreshes stream URLs for all favorited magnets across all users, so that a user's favorite list is always immediately streamable.

---

## Search Query Recording

Every successful `searchTorrents` / `searchSingleWebsite` call records the `(query, website, category)` tuple in the `search_queries` collection (via `MongoSearchQueryRepository.upsert()`). This is a fire-and-forget operation.

The `searchQueryCacheService` background job (every 2 hours) reads all distinct queries from the last 2 days, re-executes each search, pre-warms Redis with the results, and caches cover images for found torrents. At the end of the run, it deletes `search_queries` rows older than 2 days to keep the collection small.
