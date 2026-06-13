# Configuration

All configuration is read from environment variables. Copy `.env.example` to `.env` for local development.

---

## Core Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Set to `production` to enable rate limiting, strict CORS, and other production hardening. |
| `PORT` | No | `3001` | HTTP port the server listens on. |
| `HOST` | No | `0.0.0.0` | Bind address. |

---

## Database (MongoDB)

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGODB_URI` | Yes | — | Full MongoDB connection string. May include embedded credentials: `mongodb://user:pass@host:27017/db` or `mongodb+srv://...`. |
| `MONGO_URL` | No | — | Alias for `MONGODB_URI` (checked if `MONGODB_URI` is not set). |
| `MONGO_USERNAME` | No | — | If set (and `MONGODB_URI` has no `user:pass@` segment), injected URL-encoded into the URI. |
| `MONGO_PASSWORD` | No | — | Paired with `MONGO_USERNAME`. |
| `MONGODB_DB` | No | `torrent_search` | Database name within the MongoDB server. |

---

## Google API

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | Service account JSON (as a single-line string). Must include `oauth_client_id` and `oauth_client_secret` fields for OAuth to work. |
| `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | Yes | Your Google Custom Search Engine ID (for cover image lookups). |
| `GOOGLE_CALLBACK_URL` | No | OAuth callback URL. Defaults to `http://localhost:3001/api/auth/google/callback`. Set to your public URL in production. |

---

## Authentication & Sessions

| Variable | Required | Default | Description |
|---|---|---|---|
| `SESSION_SECRET` | Yes | — | Secret used to derive the AES-256-GCM key for encrypting stored Real-Debrid API keys. Also used for session signing. Use a long random string. |
| `REAL_DEBRID_ENCRYPTION_KEY` | No | `SESSION_SECRET` | Override the key used specifically for Real-Debrid API key encryption. |
| `ALLOWED_EMAILS` | No | — | Comma-separated email addresses allowed to sign in via Google OAuth. Empty = no restriction. |

---

## CORS

| Variable | Required | Default | Description |
|---|---|---|---|
| `FRONTEND_URL` | Yes (prod) | `http://localhost:3000` | Primary frontend origin. Set this to your deployed frontend URL. |
| `ADDITIONAL_CORS_ORIGINS` | No | — | Comma-separated additional CORS origins (e.g. `https://staging.example.com`). |

---

## Security & Monitoring

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONITORING_IP_ALLOWLIST` | No | — | Comma-separated IPs or CIDR ranges (e.g. `127.0.0.1,10.0.0.0/8`) allowed to access `/api/monitoring/*` and debug endpoints. Empty = IP restriction disabled. |
| `DASHBOARD_PASSWORD` | No | — | Password sent in the `X-Dashboard-Password` header (or `dashboard_auth` cookie) to access monitoring endpoints. Empty = password gate disabled. |
| `ADDON_API_TOKEN` | No | — | Shared secret for internal addon traffic. Requests with a matching `X-Addon-Token` header skip the API rate limiter. |

---

## FlareSolverr (1337x Scraper)

| Variable | Required | Default | Description |
|---|---|---|---|
| `FLARESOLVERR_URL` | Required to use 1337x | — | Base URL of your FlareSolverr instance, e.g. `http://localhost:8191/v1`. Without this, the 1337x scraper throws an error on first use. |

---

## Real-Debrid

| Variable | Required | Default | Description |
|---|---|---|---|
| `REAL_DEBRID_API_KEY` | No | — | Global fallback Real-Debrid API key. In practice, each user stores their own key in MongoDB (encrypted). This global key is a development convenience. |

---

## Redis (Optional)

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | No | — | Redis connection URL (e.g. `redis://localhost:6379`). Required to enable the Redis catalog pre-cache job. |
| `REDIS_PASSWORD` | No | — | Redis authentication password (if set on the Redis server). |
| `BASE_URL` | No | — | The public base URL of this API instance (e.g. `https://your-api-host.example.com`). Used as part of the Redis catalog key prefix. Must match what Stremio addon users configure as `backendUrl`. |

---

## S3-Compatible Object Storage (Optional)

| Variable | Required | Default | Description |
|---|---|---|---|
| `S3_ENDPOINT` | No | — | S3-compatible endpoint URL (e.g. `https://s3.amazonaws.com` or a custom endpoint). Required to enable object storage. |
| `S3_BUCKET` | No | — | Bucket name. Required to enable object storage. |
| `S3_ACCESS_KEY_ID` | No | — | Access key ID. Required to enable object storage. |
| `S3_SECRET_ACCESS_KEY` | No | — | Secret access key. Required to enable object storage. |
| `S3_REGION` | No | `us-east` | AWS region or equivalent. |
| `S3_KEY_PREFIX` | No | `covers` | Prefix prepended to all object keys. |
| `S3_TEMP_EXPIRE_DAYS` | No | `30` | Days before a non-favorite (temp) cover object is deleted. |
| `S3_PRESIGN_DAYS` | No | `7` | Presigned URL validity in days (max 7 per SigV4 spec). |

---

## Logging

| Variable | Required | Default | Description |
|---|---|---|---|
| `BACKGROUND_JOBS_LOG_VERSION` | No | `v1` | Version subdirectory used in the background job log path. |
| `BACKGROUND_JOB_LOG_RETENTION_DAYS` | No | `30` | Number of days to keep background job log files. |
| `BACKGROUND_JOB_LOG_COMPRESS_AFTER_MS` | No | `21600000` (6 h) | Idle time before a log file is gzip-compressed. |
| `BACKGROUND_JOB_LOG_MAINTENANCE_INTERVAL_MS` | No | `86400000` (24 h) | How often the log maintenance job runs. |
| `BACKGROUND_JOB_LOG_MAINTENANCE_INITIAL_DELAY_MS` | No | `900000` (15 min) | Delay before the first log maintenance run after startup. |

---

## Cache Tuning

| Variable | Required | Default | Description |
|---|---|---|---|
| `STREAM_URL_TTL_SECONDS` | No | `72000` (20 h) | How long a cached Real-Debrid stream URL is considered fresh. The favorites refresh job runs every 24 h, so this defaults to 20 h to leave a buffer. |

---

## Railway / Platform Metadata

| Variable | Set By | Description |
|---|---|---|
| `RAILWAY_ENVIRONMENT` | Railway | Auto-set on Railway deployments; enables Railway-specific logic. |
| `RAILWAY_STATIC_URL` | Railway | Static asset CDN URL. |
| `RAILWAY_PUBLIC_DOMAIN` | Railway | Public domain of the Railway service. |

---

## Validation

`config/environment.js` validates required variables on startup. In production mode, validation failures cause the process to exit. Errors are logged with details about which variables are missing. Run `node scripts/validate-config.js` before deploying to catch issues early.

---

## Example `.env` for Local Development

```dotenv
NODE_ENV=development
PORT=3001

MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=torrent_search

GOOGLE_SERVICE_ACCOUNT_JSON=<your service account JSON>
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=<your CSE ID>
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback

SESSION_SECRET=<random 64-char hex string>
FRONTEND_URL=http://localhost:3000

REAL_DEBRID_API_KEY=

FLARESOLVERR_URL=http://localhost:8191/v1

# Optional
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
MONITORING_IP_ALLOWLIST=127.0.0.1
DASHBOARD_PASSWORD=
```
