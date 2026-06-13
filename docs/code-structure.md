# Code Structure

A module-by-module tour of every significant directory and file in the repository.

---

## Repository Layout

```
Torrent-Search-API/
├── app.js                       # Application entry point & server setup
├── index.js                     # Thin wrapper (re-exports app.js)
├── package.json
├── Dockerfile
├── playwright.config.js
│
├── config/
│   ├── environment.js           # All env-var parsing and validation
│   ├── passport.js              # Google OAuth strategy + AuthService class
│   └── studioSearchTerms.json   # Known studio names for catalog pre-cache
│
├── controllers/
│   ├── favoritesController.js   # CRUD for user favorites
│   ├── imageController.js       # Cover image lookup endpoint
│   ├── jobLogsController.js     # Background-job log file browser
│   ├── monitoringController.js  # Dashboard stats, task control triggers
│   ├── proxyController.js       # Transparent image proxy
│   ├── storageController.js     # Cached-links CRUD, magnet-link updates
│   └── torrentController.js     # Torrent search, browse, details
│
├── database/
│   ├── MongoClient.js           # MongoDB connection wrapper + helpers
│   ├── MongoAuthStore.js        # Auth collections accessor (users, sessions, codes)
│   ├── StorageProvider.js       # Central repository coordinator
│   ├── auth-schema.sql          # Reference SQL schema (documentation only)
│   ├── health-check.js          # Standalone DB health script
│   └── repositories/
│       └── mongoRepositories.js # All data repositories (cache, images, favs, …)
│
├── middleware/
│   ├── auth.js                  # AuthMiddleware class (requireAuth, optionalAuth, …)
│   ├── cors.js                  # Dynamic CORS configuration
│   ├── dashboardAuth.js         # Password gate for /api/monitoring/*
│   ├── errorHandler.js          # Global error handler, asyncHandler wrapper
│   ├── ipAllowlist.js           # CIDR/IP allowlist for monitoring endpoints
│   ├── logger.js                # Winston logger + request-logging middleware
│   ├── requestId.js             # UUID injection per request
│   └── security.js              # Helmet headers + rate limiters
│
├── routes/
│   ├── auth.js                  # /api/auth/* — Google OAuth, session, exchange
│   ├── health.js                # /health, /health/detailed, /health/ready, /health/live
│   ├── images.js                # /api/images/* — cover image endpoints
│   ├── protectedCache.js        # /api/cache/* delegating to auth + controllers
│   └── torrents.js              # /api/torrents/* — search, browse, details
│
├── services/
│   ├── torrentScraperService.js # Scraper registry and orchestration
│   ├── imageExtractorService.js # Dispatches to per-host image extractors
│   ├── backgroundJobFileLogger.js    # Wraps a job run with file logging
│   ├── backgroundJobLogMaintenance.js# Compress + prune old job log files
│   ├── coverStorageMaintenanceService.js # S3 presigned URL refresh + temp cleanup
│   ├── descriptionImageCacheService.js   # Pre-caches cover images for browse pages
│   ├── googleImagesService.js   # Google Custom Search API image lookup
│   ├── jobLogContext.js         # Per-job logger context (child logger)
│   ├── objectStorageService.js  # S3-compatible bucket client (upload, presign, delete)
│   ├── redisCatalogCacheService.js  # Stremio addon catalog Redis pre-cache
│   ├── searchQueryCacheService.js   # Refresh Redis + covers for recent queries
│   ├── searchResultsCacheService.js # Pre-resolve RD stream URLs for filter pages
│   ├── streamUrlRefreshService.js   # Re-resolve RD stream URLs for favorites
│   ├── studioSearchTerms.js     # Loads studio list from config/studioSearchTerms.json
│   │
│   ├── scrapers/
│   │   ├── 1337x.js             # FlareSolverr-based 1337x.to scraper
│   │   ├── hiddenbay.js         # TheHiddenBay scraper
│   │   ├── limeTorrent.js       # LimeTorrents scraper
│   │   ├── nyaaSI.js            # Nyaa.si anime/manga scraper
│   │   ├── pirateBay.js         # The Pirate Bay API scraper + browse
│   │   ├── pornrips.js          # Pornrips scraper
│   │   ├── torrentProject.js    # TorrentProject scraper
│   │   └── yts.js               # YTS.mx API scraper
│   │
│   └── imageExtractors/
│       ├── index.js             # Extractor registry
│       ├── imageExtractor.js    # Base extractor class
│       ├── fastpicExtractor.js
│       ├── imgbbExtractor.js
│       ├── imgtrafficExtractor.js
│       ├── imgurExtractor.js
│       ├── postimgExtractor.js
│       ├── trafficImageExtractor.js
│       └── xxxwebdlxxxExtractor.js
│
├── utils/
│   ├── secretCrypto.js          # AES-256-GCM encrypt/decrypt for stored secrets
│   └── sessionCookie.js         # Set/clear httpOnly session cookie helpers
│
├── scripts/
│   └── validate-config.js       # CLI tool: validate environment before deploy
│
├── public/
│   └── index.html               # Minimal monitoring dashboard SPA
│
└── tests/
    ├── setup.js                 # Playwright global setup
    ├── teardown.js              # Playwright global teardown
    ├── helpers/
    │   └── auth.js              # Auth helper for tests
    └── e2e/
        ├── cache.spec.js
        ├── favorites.spec.js
        ├── health.spec.js
        ├── image.spec.js
        ├── proxy.spec.js
        └── torrent.spec.js
```

---

## Key Files In Detail

### `app.js`

The heart of the application. It:
- Loads environment config and validates it (`validateEnvironment`, `validateCorsConfig`).
- Registers global process error handlers (`unhandledRejection`, `uncaughtException`).
- Builds the Express `app` with the full middleware stack.
- Calls `startServer()` — an async IIFE that connects to MongoDB, wires all route handlers (including auth-gated ones), and launches background jobs.
- Falls back to a degraded mode (no DB) if startup times out (60-second deadline), so health endpoints remain reachable.
- Installs `SIGINT`/`SIGTERM` graceful shutdown handlers.

### `config/environment.js`

Parses every environment variable and exports:
- `config` — a nested configuration object consumed throughout the app.
- `validateEnvironment()` — returns an array of validation errors; production aborts on non-empty results.
- `buildMongoUri()` — injects `MONGO_USERNAME` / `MONGO_PASSWORD` URL-encoded into the base URI when the base URI has no credentials embedded.

### `config/passport.js` (AuthService)

Exports an `AuthService` class rather than Passport strategies. Responsibilities:
- `findOrCreateUser(profile)` — upsert a user document in MongoDB.
- `createSession(userId, meta)` — insert a session record with a random token.
- `validateSession(token)` — look up session by token, check expiry, update `last_accessed_at`.
- `deleteSession(token)` — expire a session.
- `createExchangeCode(token)` / `consumeExchangeCode(code)` — single-use short-lived codes for SPA auth handoff.
- `setRealDebridApiKey(userId, key)` — encrypt with `secretCrypto` and persist.
- `getRealDebridApiKey(userId)` — decrypt and return.

Also configures the `passport-google-oauth20` strategy. The strategy is stateless (no Passport sessions); sessions are managed directly in MongoDB.

### `database/StorageProvider.js`

The central coordinator for all data access. On `initialize()` it connects MongoDB and instantiates all repository classes. Also provides a set of legacy convenience methods that delegate to the correct repository (marked `@deprecated` to encourage callers to use repositories directly).

Key repositories (all implemented in `database/repositories/mongoRepositories.js`):
- `MongoCacheRepository` — generic key-value cache with TTL.
- `MongoImageRepository` — cover images (binary or S3 key + presigned URL).
- `MongoStreamUrlRepository` — cached Real-Debrid stream URL per magnet hash.
- `MongoFavoriteRepository` — user favorites + favorite entries (torrent metadata snapshots).
- `MongoCachedLinkRepository` — user-pinned "stored links".
- `MongoTorrentDetailsRepository` — scraped torrent detail blobs associated with a favorite entry.
- `MongoSearchQueryRepository` — distinct (query, website, category) tuples recorded for cache-warming.

### `database/MongoAuthStore.js`

Thin wrapper that exposes named collection accessors (`users()`, `sessions()`, `exchangeCodes()`) used by `AuthService` and the auth route's session-listing endpoint.

### `services/torrentScraperService.js`

The scraper registry. Imports every scraper module and maintains a map from site name to scraper function. Exports:
- `getAvailableScrapers()` — list of supported site names.
- `searchTorrents(website, query, page, options)` — route to the right scraper.
- `searchAllTorrents(query, page, options)` — fan out to all scrapers in parallel, merge and de-duplicate.
- `getTorrentDetails(website, url)` — fetch detailed page for a single torrent.
- `getScraper(name)` — get a raw scraper module (used by `browseTorrents`).

### `services/imageExtractorService.js`

Accepts a scraped description string and extracts cover image URLs. It tries multiple host-specific extractors (Imgur, imgbb, PostImg, fastpic, imgtraffic, etc.) registered in `services/imageExtractors/index.js`. Each extractor understands the URL scheme or HTML structure of one image host.

### `services/objectStorageService.js`

S3-compatible bucket client built on `@aws-sdk/client-s3`. Objects are organised under two prefixes:
- `{KEY_PREFIX}/keep/<torrentKey>.jpg` — favorite covers, kept indefinitely.
- `{KEY_PREFIX}/temp/<torrentKey>.jpg` — non-favorite covers, cleaned up after `S3_TEMP_EXPIRE_DAYS`.

Presigned GET URLs (SigV4, max 7 days) are generated for every object and stored in MongoDB so the frontend never hits the bucket directly.

### `utils/secretCrypto.js`

AES-256-GCM encryption/decryption for Real-Debrid API keys stored in MongoDB. The encryption key is derived from `SESSION_SECRET` (or `REAL_DEBRID_ENCRYPTION_KEY` if set) via SHA-256. Ciphertext format: `v1:<iv_b64>:<tag_b64>:<data_b64>`. Accepts unencrypted legacy values transparently (detected by absence of the `v1:` prefix).

### `middleware/auth.js` (AuthMiddleware)

Exports a class with four methods:
- `requireAuth()` — reject with 401 if no valid session.
- `optionalAuth()` — populate `req.user` if a valid token is present, continue regardless.
- `getUserRealDebridKey()` — require auth + decrypt and attach the user's RD key to `req.realDebridApiKey`.
- `restrictToOwner(fn)` — compare resource owner to `req.userId`, reject with 403 if mismatched.

### `middleware/security.js`

- `securityHeaders()` — Helmet with CSP disabled (inline scripts are used in the monitoring dashboard).
- `createRateLimiters()` — two `express-rate-limit` instances: one for `/api/auth/*` (100/15 min), one for `/api/*` (1000/15 min). Rate limiting is only enabled in production. The API limiter skips requests carrying a valid `X-Addon-Token` (for internal addon traffic).

### `middleware/ipAllowlist.js`

Reads `MONITORING_IP_ALLOWLIST` (comma-separated IPs / CIDR ranges). When empty, the middleware is a no-op (pass-through). When set, requests from unlisted IPs receive `403 Forbidden`. Used on all `/api/monitoring/*` and `/api/debug/*` routes.

### `middleware/dashboardAuth.js`

Password-gates the monitoring routes by checking the `X-Dashboard-Password` header or `dashboard_auth` cookie against `DASHBOARD_PASSWORD`. When `DASHBOARD_PASSWORD` is unset, this middleware is a no-op.
