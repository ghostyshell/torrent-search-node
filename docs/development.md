# Development

Instructions for setting up a local development environment, running the server, executing tests, and building a Docker image.

---

## Prerequisites

- **Node.js** 22+ (see `.nvmrc` — `nvm use` will pick the right version)
- **npm** 10+
- **MongoDB** 6+ running locally or accessible via URI
- Optionally: Redis, an S3-compatible bucket, FlareSolverr (for 1337x scraper)

---

## Install

```bash
git clone https://github.com/akshatsinghkaushik/torrent-search-node.git
cd torrent-search-node
npm install
```

---

## Environment Setup

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Minimum required values for local development:

```dotenv
MONGODB_URI=mongodb://localhost:27017
GOOGLE_SERVICE_ACCOUNT_JSON=<service account JSON>
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=<CSE ID>
SESSION_SECRET=<64-char random hex>
FRONTEND_URL=http://localhost:3000
```

See [configuration.md](configuration.md) for the full variable reference.

---

## Run

### Development (with auto-reload via nodemon)

```bash
npm start
```

The server starts on `http://localhost:3001` by default.

### Production (no nodemon)

```bash
npm run start-server
```

### With NODE_ENV=production explicitly

```bash
npm run start:prod
```

### Validate configuration before starting

```bash
npm run validate-config
```

---

## npm Scripts

| Script | Description |
|---|---|
| `npm start` | Start with nodemon (development auto-reload) |
| `npm run start-server` | Start with Node (no watcher, `--max-old-space-size=3072`) |
| `npm run start:prod` | Same as above but sets `NODE_ENV=production` |
| `npm run validate-config` | Validate env vars, print errors and exit |
| `npm test` | Run end-to-end Playwright tests |
| `npm run test:headed` | Run tests with browser visible |
| `npm run test:debug` | Run tests in Playwright debug mode |
| `npm run test:ui` | Run tests with the Playwright UI |
| `npm run test:report` | Open the last Playwright HTML report |
| `npm run db:health` | Run the database health check script |
| `npm run health:check` | Curl `/health` and exit non-zero on failure |
| `npm run health:detailed` | Curl `/health/detailed` |

---

## Tests

The test suite is built with [Playwright](https://playwright.dev/), running HTTP end-to-end tests against a live server.

### Setup

```bash
npm install
npx playwright install   # download browser binaries
```

Playwright configuration lives in `playwright.config.js`. Tests live in `tests/e2e/`. The global setup/teardown scripts are in `tests/setup.js` and `tests/teardown.js`.

### Run

```bash
npm test                  # headless
npm run test:headed       # visible browser
npm run test:debug        # step-through debugger
```

Test specs:
- `tests/e2e/health.spec.js` — health endpoint assertions
- `tests/e2e/torrent.spec.js` — search and details endpoints
- `tests/e2e/cache.spec.js` — cache CRUD
- `tests/e2e/favorites.spec.js` — favorites CRUD
- `tests/e2e/image.spec.js` — image endpoints
- `tests/e2e/proxy.spec.js` — image proxy

---

## Docker

### Build

```bash
docker build -t torrent-search-api .
```

### Run

```bash
docker run -p 3001:3001 \
  -e MONGODB_URI=mongodb://host.docker.internal:27017 \
  -e GOOGLE_SERVICE_ACCOUNT_JSON='...' \
  -e GOOGLE_CUSTOM_SEARCH_ENGINE_ID='...' \
  -e SESSION_SECRET='...' \
  -e FRONTEND_URL='http://localhost:3000' \
  torrent-search-api
```

### Dockerfile details

- Base image: `node:22-alpine`
- Init process: `dumb-init` (proper signal handling)
- User: non-root `nodejs` (UID 1001)
- Health check: `GET http://localhost:3001/health` every 30 s
- Entry point: `node --max-old-space-size=3072 app.js`

---

## PM2 (Production Process Manager)

The repo includes `pm2:*` npm scripts:

```bash
npm run pm2:start     # Start under PM2 with production env
npm run pm2:stop      # Stop
npm run pm2:restart   # Restart
npm run pm2:logs      # Tail logs
npm run pm2:monit     # Live metrics monitor
npm run pm2:status    # Status table
```

An `ecosystem.config.js` file (not checked in — provide your own) is expected at the repo root for the `pm2:start` command.

---

## Directory Structure for Logs

Background job logs are written to:

```
logs/
└── background-jobs/
    └── v1/
        └── <jobName>/
            └── <YYYY-MM-DD>/
                └── <runId>.log
```

- Active log files are plain text.
- After `BACKGROUND_JOB_LOG_COMPRESS_AFTER_MS` of inactivity (default 6 h), logs are gzip-compressed to `.log.gz`.
- Files older than `BACKGROUND_JOB_LOG_RETENTION_DAYS` (default 30 days) are deleted by the log-maintenance job.

The `logs/` directory is ignored by git.

---

## Adding a New Scraper

1. Create `services/scrapers/<name>.js` exporting the standard search function.
2. Optionally attach `.getDetails`, `.browse` properties.
3. Register it in `services/torrentScraperService.js` (add to the scraper map).
4. Test it via `GET /api/torrents/search/<name>/ubuntu/1`.

See [scrapers.md](scrapers.md) for the expected function signature and result shape.

---

## Environment Validation

Before deploying, run:

```bash
NODE_ENV=production node scripts/validate-config.js
```

This checks all required variables and prints any missing ones. The server also validates on startup and exits immediately in production if validation fails.
