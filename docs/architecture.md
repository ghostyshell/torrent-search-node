# Architecture

This document describes the overall system architecture of the Torrent Search API — a Node.js / Express REST backend for torrent search, image retrieval, and optional streaming integration.

---

## High-Level Overview

```
  Client (browser / frontend / Stremio addon)
         │
         │  HTTP (REST)
         ▼
  ┌──────────────────────────────────────────────┐
  │              Express Application             │
  │   (app.js — middleware stack, route wiring)  │
  │                                              │
  │  ┌────────────┐  ┌────────────┐              │
  │  │  routes/   │  │middleware/ │              │
  │  └─────┬──────┘  └────────────┘              │
  │        │                                     │
  │  ┌─────▼──────┐                              │
  │  │controllers/│                              │
  │  └─────┬──────┘                              │
  │        │                                     │
  │  ┌─────▼──────────────────────────────────┐  │
  │  │             services/                  │  │
  │  │  torrentScraperService (orchestrator)  │  │
  │  │  scrapers/ (per-site modules)          │  │
  │  │  imageExtractorService                 │  │
  │  │  background cache jobs                 │  │
  │  └─────┬──────────────────────────────────┘  │
  │        │                                     │
  │  ┌─────▼──────┐  ┌──────────────────────┐    │
  │  │ database/  │  │ External services    │    │
  │  │ (MongoDB)  │  │  Redis, S3, RD, CSE  │    │
  │  └────────────┘  └──────────────────────┘    │
  └──────────────────────────────────────────────┘
```

---

## Request Lifecycle

A typical search request flows through these layers in order:

```
1. Incoming HTTP request
        │
2. Global middleware (requestId → securityHeaders → rateLimiter → requestLogger
                      → apiTracking → bodyParser → cookieParser → CORS → passport)
        │
3. Route matching  (routes/torrents.js, routes/auth.js, routes/images.js, ...)
        │
4. Auth middleware  (AuthMiddleware.requireAuth / optionalAuth — reads session token
                     from Authorization header or sessionToken cookie)
        │
5. Controller       (e.g. torrentController.searchTorrents)
        │
6. Service layer    (torrentScraperService → individual scraper → cheerio parse)
        │
7. Optional enrichment  (cover images from MongoDB/S3 cache)
        │
8. JSON response
```

On startup (within `startServer()` in `app.js`), the application:
1. Initialises `StorageProvider` (MongoDB connection + all repositories).
2. Wires `AuthMiddleware` and `IpAllowlistMiddleware`.
3. Registers all routes with their middleware.
4. Launches eight periodic background jobs.
5. Begins listening on `PORT`.

---

## Layering: Routes → Controllers → Services

| Layer | Responsibility |
|---|---|
| `routes/` | Mount paths, apply middleware, delegate to controllers |
| `controllers/` | Parse request params, call services, format HTTP response |
| `services/` | Business logic — scraping, caching, image extraction, background jobs |
| `database/` | Repository pattern over MongoDB; auth store |
| `middleware/` | Cross-cutting concerns: auth, security, CORS, logging, errors |
| `config/` | Environment-derived configuration, Passport/OAuth setup |
| `utils/` | Pure helpers (AES-256-GCM secret encryption, session cookie helpers) |

---

## Middleware Stack

Applied globally (in order) in `app.js`:

| Order | Middleware | Purpose |
|---|---|---|
| 1 | `requestIdMiddleware` | Attaches a unique `req.id` UUID to every request |
| 2 | `securityHeaders` | Helmet security headers (CSP disabled for dashboard compatibility) |
| 3 | `authLimiter` | Rate-limit `/api/auth/*` (100 req / 15 min, production only) |
| 4 | `apiLimiter` | Rate-limit `/api/*` (1000 req / 15 min, production only) |
| 5 | `requestLogger` | Winston-based structured request log |
| 6 | `apiTrackingMiddleware` | In-memory API usage counter (exposed on monitoring dashboard) |
| 7 | `express.json / urlencoded` | Body parsing up to 50 MB |
| 8 | `cookieParser` | Parse cookies (used for `sessionToken`) |
| 9 | `corsMiddleware` | Environment-specific CORS allow-list |
| 10 | `passport.initialize` | OAuth strategy initialisation (no sessions — stateless JWT-like tokens) |
| 11 | `express.static` | Serve `public/` directory |

Route-level middleware applied selectively:
- `AuthMiddleware.requireAuth()` — validates session token, attaches `req.user` / `req.userId`.
- `dashboardAuth()` — checks `X-Dashboard-Password` header / `dashboard_auth` cookie for monitoring routes.
- `IpAllowlistMiddleware.restrictToAllowlist()` — CIDR/IP allowlist for monitoring and debug endpoints.
- `AuthMiddleware.getUserRealDebridKey()` — retrieves and decrypts the user's Real-Debrid API key.

---

## Authentication Model

The API uses **session-token-based auth** (not JWT, despite `jsonwebtoken` being a dependency — it is only used internally by some token-exchange helpers).

1. User initiates Google OAuth via `GET /api/auth/google`.
2. Passport redirects to Google; callback arrives at `GET /api/auth/google/callback`.
3. The server calls `AuthService.findOrCreateUser` (upserts a MongoDB user document), creates a session record, and sets a `sessionToken` cookie.
4. An **exchange code** (short-lived, single-use) is appended to the frontend redirect URL so SPA clients can convert it to a session token via `POST /api/auth/exchange`.
5. Subsequent requests include the session token either via:
   - `Authorization: Bearer <token>` header, or
   - `sessionToken` cookie.
6. `AuthMiddleware.requireAuth()` validates the token against MongoDB (expiry check, user lookup) and populates `req.user`.

An email allowlist (`ALLOWED_EMAILS` env var) optionally restricts who can complete the OAuth flow.

Real-Debrid API keys are stored encrypted in MongoDB using AES-256-GCM via `utils/secretCrypto.js` (key derived from `SESSION_SECRET`).

---

## Caching Layers

The application uses three distinct caching mechanisms:

### 1. MongoDB (primary persistent store)
Stores cover images, stream URLs, search query history, favorites, cached links, and general key-value cache entries. All data survives restarts.

### 2. Redis (catalog pre-cache)
An optional Redis instance stores pre-computed Stremio addon catalog responses. The `RedisCatalogCacheService` background job writes normalised torrent lists at 25–35-minute jittered intervals. Reads served directly from Redis avoid hitting the upstream torrent site on every addon load. Requires `REDIS_URL` and `BASE_URL`.

### 3. S3-Compatible Object Storage
Cover images are fetched from upstream sources and stored in an S3-compatible private bucket. Presigned GET URLs (7-day validity by default) are generated and stored in MongoDB. A background maintenance job refreshes these URLs before they expire and deletes temp objects older than `S3_TEMP_EXPIRE_DAYS` days.

---

## Background Jobs

Eight periodic jobs start after the database initialises:

| Job | Schedule | Purpose |
|---|---|---|
| `storageCleanup` | Every 60 min | Delete expired cache entries and old stream URLs |
| `streamUrlRefresh` | Every 24 h | Re-resolve Real-Debrid stream URLs for all favorited magnets |
| `descriptionImageCache` | Every 6 h | Pre-cache cover images for browse/filter page results |
| `searchResultsCache` | Every 6 h | Pre-resolve RD stream URLs for filter page results |
| `redisCatalogCache` | Every 25–35 min (jittered) | Populate Redis catalog keys for the Stremio addon |
| `searchQueryCache` | Every 2 h | Refresh Redis entries + cover images for recent search queries |
| `coverStorageMaintenance` | Every 5 h | Refresh S3 presigned URLs; delete expired temp covers |
| `jobLogMaintenance` | Every 24 h | Compress idle background-job log files; delete old logs |

Each job is wrapped in `runWithJobFileLogging`, which streams structured log output to a dedicated log file (`logs/background-jobs/v1/<jobName>/<date>/<runId>.log`).

---

## External Service Dependencies

| Service | Used For | Required |
|---|---|---|
| MongoDB | All persistent storage, auth, sessions | Yes |
| Google OAuth | User sign-in | Yes |
| Google Custom Search | Cover image search | Yes |
| Real-Debrid | Resolve magnet links to direct stream URLs | No (per-user key) |
| FlareSolverr | Bypass Cloudflare on the 1337x scraper | Only if 1337x is used |
| Redis | Stremio addon catalog pre-cache | No |
| S3-compatible bucket | Cover image object storage | No |

---

## Deployment Topology

The application ships as a single Node.js process (no microservices split). Deployment options supported out of the box:

- **Docker** — `Dockerfile` uses Node 22 Alpine, `dumb-init`, non-root user, health check.
- **PM2** — `package.json` includes `pm2:*` scripts; an `ecosystem.config.js` is expected at runtime.
- **Railway** — auto-detected via `RAILWAY_ENVIRONMENT`; port injected automatically.
- **Serverless** — a `serverless.yml` path and `deploy:aws` npm scripts support AWS Lambda via `serverless-http`.
