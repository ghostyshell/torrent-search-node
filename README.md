# Torrent Search API

A self-hostable Node.js / Express REST API for searching torrents across multiple sources, resolving magnet links via Real-Debrid, and serving cached cover images — all in a single process.

**License:** GPL-3.0-or-later

---

## What It Does

- **Multi-source torrent search** — query Pirate Bay, 1337x, YTS, Nyaa.si, LimeTorrents, TorrentProject, TheHiddenBay, or Pornrips simultaneously.
- **Magnet link details** — fetch description, file list, magnet URI, and cover images for any torrent.
- **Real-Debrid integration** — resolve magnet links to direct stream URLs; results are cached for 20 hours and refreshed daily in the background.
- **Cover image caching** — extract art from torrent descriptions; store in MongoDB or an S3-compatible bucket with presigned URL auto-refresh.
- **Google OAuth authentication** — per-user favorites, stored links, and encrypted Real-Debrid API key storage.
- **Redis catalog pre-cache** — pre-populates catalog keys for Stremio addon integrations.
- **Eight background jobs** — autonomous cache-warming, log maintenance, and storage cleanup on configurable schedules.
- **Docker-ready** — Alpine image with `dumb-init`, non-root user, and health check built in.

---

## Requirements

- Node.js 22+
- MongoDB 6+
- Google Cloud project with a service account and OAuth 2.0 client

Optional:
- Redis — enables the catalog pre-cache job
- S3-compatible bucket — stores cover images as binary objects with presigned URLs
- FlareSolverr — required only for the 1337x scraper (Cloudflare bypass)

---

## Quick Start

```bash
git clone https://github.com/akshatsinghkaushik/stream-backend.git
cd stream-backend
npm install
cp .env.example .env
# Fill in MONGODB_URI, GOOGLE_*, SESSION_SECRET, FRONTEND_URL in .env
npm start
```

Or with Docker:

```bash
docker build -t torrent-search-api .
docker run -p 3001:3001 \
  -e MONGODB_URI=mongodb://host:27017 \
  -e GOOGLE_SERVICE_ACCOUNT_JSON='...' \
  -e GOOGLE_CUSTOM_SEARCH_ENGINE_ID='...' \
  -e SESSION_SECRET='...' \
  -e FRONTEND_URL='http://localhost:3000' \
  torrent-search-api
```

The API listens on port `3001` by default. Check `GET /health` to confirm it is running.

---

## Example Requests

```bash
# Search Pirate Bay
curl "http://localhost:3001/api/torrents/search/piratebay/ubuntu/1"

# Search all sources with filters
curl -X POST "http://localhost:3001/api/torrents/advanced-search" \
  -H "Content-Type: application/json" \
  -d '{"query":"ubuntu","websites":["all"],"minSeeders":10,"maxResults":20}'

# Get torrent details (magnet, files, images)
curl "http://localhost:3001/api/torrents/details/yts/$(python3 -c \
  "import urllib.parse; print(urllib.parse.quote('https://yts.mx/movies/...'))")"

# Health check
curl "http://localhost:3001/health"
```

---

## Configuration

All settings are environment variables. Copy `.env.example` and fill in your values.

Minimum required:

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google service account JSON (single-line) |
| `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | Google Custom Search Engine ID |
| `SESSION_SECRET` | 64-char random secret for session signing and key encryption |
| `FRONTEND_URL` | Allowed CORS origin for your frontend |

Key optional variables:

| Variable | Description |
|---|---|
| `FLARESOLVERR_URL` | URL of your FlareSolverr instance (required for 1337x) |
| `REDIS_URL` | Redis connection URL (enables catalog pre-cache) |
| `BASE_URL` | Public URL of this API (used as Redis key prefix) |
| `S3_ENDPOINT` | S3-compatible endpoint (enables object storage for cover images) |
| `DASHBOARD_PASSWORD` | Password protecting `/api/monitoring/*` endpoints |
| `ALLOWED_EMAILS` | Comma-separated email allowlist for Google OAuth |

Full reference: [docs/configuration.md](docs/configuration.md)

---

## Available Scripts

```bash
npm start              # Development (nodemon auto-reload)
npm run start:prod     # Production (NODE_ENV=production)
npm run validate-config # Validate env vars before deploy
npm test               # Run Playwright e2e tests
npm run db:health      # Check database connectivity
npm run health:check   # Curl /health and exit non-zero on failure
```

---

## Documentation

- [Architecture](docs/architecture.md) — request lifecycle, middleware stack, auth model, background jobs
- [Code Structure](docs/code-structure.md) — module-by-module tour of every directory and file
- [API Reference](docs/api-reference.md) — all endpoints with parameters and example responses
- [Scrapers](docs/scrapers.md) — scraper architecture, FlareSolverr integration, per-source notes
- [Caching and Storage](docs/caching-and-storage.md) — MongoDB, Redis, and S3 usage in detail
- [Configuration](docs/configuration.md) — every environment variable with defaults and descriptions
- [Development](docs/development.md) — install, run, test, Docker, PM2, adding a new scraper

Landing page: [akshatsinghkaushik.github.io/stream-backend](https://akshatsinghkaushik.github.io/stream-backend/)

---

## Supported Sources

| Key | Site | Method |
|---|---|---|
| `piratebay` | The Pirate Bay | JSON API |
| `1337x` | 1337x.to | HTML + FlareSolverr |
| `yts` | YTS.mx | JSON API |
| `nyaasi` | Nyaa.si | HTML |
| `limetorrent` | LimeTorrents | HTML |
| `torrentproject` | TorrentProject | HTML |
| `hiddenbay` | TheHiddenBay | HTML |
| `pornrips` | Pornrips | HTML |

---

## License

This project is released under the [GNU General Public License v3.0 or later](LICENSE) (GPL-3.0-or-later).

You are free to use, modify, and distribute this software under the terms of the GPL. Derivative works must be distributed under the same license.
