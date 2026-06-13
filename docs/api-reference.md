# API Reference

All endpoints are prefixed with the server base URL (default `http://localhost:3001`).

Authentication uses a **session token** — pass it either as:
- `Authorization: Bearer <token>` header, or
- `sessionToken` HTTP-only cookie (set automatically by the server after login).

---

## Health

### `GET /health`
Basic liveness check. No auth required.

**Response**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:00:00.000Z",
  "environment": "production",
  "uptime": 3600
}
```

### `GET /health/detailed`
Full health report including database and Google API status.

**Response**
```json
{
  "status": "healthy",
  "timestamp": "...",
  "environment": "production",
  "version": "1.0.0",
  "uptime": 3600,
  "memory": { "rss": 128, "heapTotal": 64, "heapUsed": 48, "external": 2 },
  "services": {
    "database": { "status": "healthy", "type": "MongoDB", "responseTime": 3 },
    "google": { "status": "healthy", "configured": true }
  },
  "responseTime": 12
}
```

### `GET /health/ready`
Readiness probe. Returns `503` when the database is not ready.

### `GET /health/live`
Liveness probe. Returns `200 { "alive": true }` if the process is running.

### `GET /health/1337x`
Diagnostic for the 1337x scraper: tests FlareSolverr connectivity and a sample search.

---

## Authentication

### `GET /api/auth/google`
Redirect to Google OAuth. No body. Browser-only — redirects to Google.

### `GET /api/auth/google/callback`
OAuth callback. Google redirects here after user consent. Sets a `sessionToken` cookie and redirects to `FRONTEND_URL?auth_exchange=<code>`.

### `POST /api/auth/exchange`
Exchange a one-time code (from the OAuth redirect) for a session token.

**Body**
```json
{ "code": "abc123..." }
```

**Response**
```json
{
  "success": true,
  "token": "<session_token>",
  "user": {
    "id": "...",
    "email": "user@example.com",
    "name": "Alice",
    "picture": "https://...",
    "hasRealDebridKey": false,
    "createdAt": 1700000000,
    "lastLoginAt": 1700000000,
    "isEmailAllowed": true
  }
}
```

### `POST /api/auth/validate`
Validate an existing token.

**Body** (any one of):
```json
{ "token": "<session_token>" }
```
or pass via cookie / `Authorization` header.

**Response** — same shape as `/api/auth/exchange` (without the `token` field).

### `GET /api/auth/user`
Return the current authenticated user. **Requires auth.**

### `POST /api/auth/logout`
Invalidate the current session. **Requires auth.** Clears the `sessionToken` cookie.

### `GET /api/auth/sessions`
List all active sessions for the current user. **Requires auth.**

### `GET /api/auth/realdebrid/api-key`
Check whether a Real-Debrid API key is stored for the user. **Requires auth.**

**Response** `{ "success": true, "hasApiKey": true }`

### `POST /api/auth/realdebrid/api-key`
Store / update the Real-Debrid API key. The key is encrypted with AES-256-GCM before storing. **Requires auth.**

**Body** `{ "apiKey": "ABCD..." }`

### `DELETE /api/auth/realdebrid/api-key`
Remove the stored Real-Debrid API key. **Requires auth.**

---

## Torrent Search

### `GET /api/torrents/websites`
List supported scraper sources.

**Response**
```json
["piratebay", "1337x", "yts", "nyaasi", "limetorrent", "torrentproject", "hiddenbay", "pornrips"]
```

### `GET /api/torrents/search/:website/:query/:page?`
Search a single torrent site.

| Parameter | Type | Description |
|---|---|---|
| `website` | path | Site key (from `/websites`) |
| `query` | path | Search term |
| `page` | path (optional) | Page number, default 1 |
| `minSeeders` | query | Minimum seeder count |
| `maxResults` | query | Cap result count |
| `includeCoverImages` | query | `true` to attach cached cover images |
| `sort` | query | Sort field (site-dependent) |
| `category` | query | Category filter (site-dependent) |

**Response**
```json
{
  "success": true,
  "website": "piratebay",
  "query": "ubuntu",
  "page": 1,
  "results": [
    {
      "Name": "Ubuntu 24.04 LTS Desktop",
      "Size": "4.7 GB",
      "Seeders": "1234",
      "Leechers": "56",
      "MagnetLink": "magnet:?xt=urn:btih:...",
      "Url": "https://...",
      "Source": "piratebay"
    }
  ]
}
```

### `GET /api/torrents/:website/:query/:page?`
Backward-compatible alias for the search endpoint above (same parameters, same response shape but unwrapped array).

### `GET /api/:website/:query/:page?`
Legacy catch-all alias (registered last to avoid conflicts).

### `POST /api/torrents/advanced-search`
Search multiple sites simultaneously with filters.

**Body**
```json
{
  "query": "ubuntu",
  "websites": ["piratebay", "yts"],
  "minSeeders": 10,
  "maxResults": 50,
  "sortBy": "Seeders",
  "sortOrder": "desc",
  "includeCoverImages": false
}
```

**Response**
```json
{
  "success": true,
  "query": "ubuntu",
  "websites": ["piratebay", "yts"],
  "filters": { "minSeeders": 10, "maxResults": 50, "sortBy": "Seeders", "sortOrder": "desc" },
  "totalResults": 23,
  "results": [ ... ]
}
```

### `GET /api/torrents/browse/:category/:page?`
Browse a torrent site by category without a search query.

| Parameter | Type | Description |
|---|---|---|
| `category` | path | Site-specific category ID (e.g. `507` for Pirate Bay XXX 4K) |
| `page` | path (optional) | Page number |
| `website` | query | Site key, default `piratebay` |
| `sort` | query | Sort code, default `3` (newest) |

### `GET /api/torrents/details/:website/:torrentUrl`
Fetch full details for a single torrent (description, magnet link, file list, images).

| Parameter | Type | Description |
|---|---|---|
| `website` | path | Site key |
| `torrentUrl` | path | URL-encoded detail page URL |

**Response**
```json
{
  "description": "...",
  "magnet": "magnet:?xt=urn:btih:...",
  "hash": "ABCDEF...",
  "files": [{ "name": "ubuntu.iso", "size": "4.7 GB" }],
  "images": [{ "originalUrl": "https://...", "directUrl": "https://..." }]
}
```

---

## Images

### `GET /api/images/cover`
Look up a cached cover image for a torrent.

**Query params:** `name`, `source` (site key), `url` (torrent page URL).

**Response** — presigned S3 URL, direct image URL, or base64 blob depending on how the image is stored.

### `POST /api/images/search`
Search Google Custom Search for a cover image and cache the result.

**Body** `{ "query": "search term", "torrent": { ... } }`

### `GET /api/images/proxy`
Transparent image proxy — fetches the remote image and streams it back. Used to avoid CORS issues.

**Query params:** `url` — the remote image URL to proxy.

> Legacy aliases: `/api/google-images/*` and `/api/proxy/*` map to the same handlers.

---

## Favorites

All favorites endpoints **require auth**. A "favorite" is a saved torrent with optional metadata and a cover image. A "favorite entry" is the detailed snapshot of a specific torrent including its magnet link and associated stream URL.

### `POST /api/cache/favorites` or `POST /api/storage/favorites`
Add a torrent to the user's favorites.

**Body** — torrent object `{ Name, Url, MagnetLink, Size, Seeders, ... }`

### `GET /api/cache/favorites` or `GET /api/storage/favorites`
List favorites (paginated).

### `DELETE /api/cache/favorites` or `DELETE /api/storage/favorites`
Remove a favorite. **Body** — torrent identifier.

### `GET /api/favorites/:favoriteId/details`
Retrieve detailed metadata for a favorite entry, including cover image.

### `POST /api/favorites/:favoriteId/details`
Store or update details for a favorite entry.

### `POST /api/favorites/check`
Check if a torrent is already in the user's favorites.

**Body** — torrent object.

**Response** `{ "success": true, "isFavorite": true, "favoriteId": "..." }`

### `POST /api/favorites/entry`
Explicitly create a favorite entry (snapshot of torrent data + magnet link).

### `PUT /api/storage/favorites/:favoriteId/magnet`
Update the magnet link stored on a favorite entry.

**Body** `{ "magnetLink": "magnet:?xt=..." }`

---

## Cached Links (Stored Links)

All endpoints **require auth**.

### `POST /api/storage/stored-links` or `POST /api/cache/cached-links`
Add a link to the user's stored links.

### `GET /api/storage/stored-links` or `GET /api/cache/cached-links`
List stored links (paginated).

### `DELETE /api/storage/stored-links/:id` or `DELETE /api/cache/cached-links/:id`
Delete a stored link by ID.

### `PUT /api/storage/stored-links/:id` or `PUT /api/cache/cached-links/:id`
Update a stored link (e.g. add/change cover image, title).

---

## Monitoring

All monitoring endpoints require the `X-Dashboard-Password` header (if `DASHBOARD_PASSWORD` is set) and may additionally be restricted by IP allowlist (`MONITORING_IP_ALLOWLIST`).

### `GET /api/monitoring/dashboard`
Overall dashboard data: storage stats, background task status, recent log entries.

### `GET /api/monitoring/logs`
Recent application log entries.

### `GET /api/monitoring/tasks`
Background task statistics (last run time, status, counts).

### `GET /api/monitoring/api-usage`
Per-path API request counts since the process started.

### `GET /api/monitoring/stream-url-refresh-logs`
Log output from the most recent stream-URL-refresh job run.

### `POST /api/monitoring/stream-url-refresh-trigger`
Manually trigger a stream-URL-refresh job run.

### `GET /api/monitoring/description-image-cache-logs`
Log output from the description/image cache job.

### `POST /api/monitoring/description-image-cache-trigger`
Trigger description/image cache job.

### `POST /api/monitoring/description-image-cache-force-refresh`
Force a full re-cache (ignore existing cached images).

### `GET /api/monitoring/search-results-cache-logs`
Log output from the search-results cache job.

### `POST /api/monitoring/search-results-cache-trigger`
Trigger search-results cache job.

### `GET /api/monitoring/redis-catalog-cache-logs`
Log output from the Redis catalog cache job.

### `POST /api/monitoring/redis-catalog-cache-trigger`
Trigger Redis catalog cache job.

### `POST /api/monitoring/cover-storage-maintenance-trigger`
Trigger cover-storage maintenance (presigned URL refresh + temp cleanup).

### `GET /api/monitoring/search-query-cache-logs`
Log output from the search-query cache job.

### `POST /api/monitoring/search-query-cache-trigger`
Trigger search-query cache job.

### `GET /api/monitoring/job-logs/list`
List available background-job log files.

### `GET /api/monitoring/job-logs/search`
Search job log content. **Query params:** `jobName`, `date`, `query`.

### `GET /api/monitoring/job-logs/file`
Download a specific job log file. **Query params:** `path`.

### `POST /api/monitoring/job-logs/maintenance`
Trigger job-log maintenance (compress + prune).

### `GET /api/monitoring/debug-favorites`
Debug endpoint: returns favorites stats + sample entries.

---

## Debug

### `GET /api/debug/favorite-entry/:favoriteEntryId`
Raw lookup of a single favorite entry by ID. IP-restricted.

---

## Error Responses

All error responses use a consistent envelope:

```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

Common HTTP status codes:
- `400` — bad request (missing or invalid parameters)
- `401` — authentication required or invalid session
- `403` — forbidden (email not allowed, IP not in allowlist)
- `404` — resource not found
- `429` — rate limit exceeded
- `500` — internal server error
- `503` — service unavailable (database down, dependency error)
