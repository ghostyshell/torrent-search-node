---
name: torrent-api-context
description: Node.js API context. Use for Express routes, Cheerio scrapers, MongoDB/Turso storage, Redis cache, auth, Real-Debrid proxy, background jobs, or deployment.
---

You are working in **torrent-search-node** — a Node.js backend for torrent search and streaming.

## Stack

- Express 4, Cheerio for HTML scraping
- MongoDB (primary DB) + Turso import path, Redis catalog cache, S3 object storage
- Passport Google OAuth, express-session, JWT
- Real-Debrid integration, Google Custom Search for images
- PM2 production, Serverless AWS CDK, Docker
- Playwright + Jest + supertest for testing

## Key paths

| Area | Path |
|------|------|
| App entry | `app.js` |
| Environment | `config/environment.js`, `.env.example` |
| Scrapers (registry) | `services/torrentScraperService.js` |
| Individual scrapers | `services/scrapers/` (pirateBay, 1337x, yts, nyaaSI, limeTorrent, torrentProject, hiddenbay, pornrips) |
| Image extraction | `services/imageExtractorService.js`, `services/imageExtractors/` |
| Cache layers | `services/redisCatalogCacheService.js`, `services/searchResultsCacheService.js`, `services/searchQueryCacheService.js`, `services/streamUrlRefreshService.js` |
| Storage | `database/` (MongoClient, StorageProvider, repositories) |
| Auth | `config/passport.js` |
| Background jobs | `services/backgroundJobFileLogger.js`, `services/coverStorageMaintenanceService.js` |
| Controllers | `controllers/` |
| Middleware | `middleware/` (cors, logger, rate limiting) |
| Tests | `playwright.config.js`, root-level Playwright specs |

## Scraper sources

Available via `torrentScraperService.getAvailableScrapers()`: piratebay, 1337x, yts, nyaaSI, limeTorrent, torrentProject, hiddenbay, pornrips.

Scrapers are fragile — site HTML changes break parsing.

## Environment

- `PORT=3001`, `MONGODB_URI`, `MONGODB_DB`
- `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CUSTOM_SEARCH_ENGINE_ID`
- `GOOGLE_CALLBACK_URL`, `SESSION_SECRET`, `FRONTEND_URL`
- `REAL_DEBRID_API_KEY`, Redis/S3 vars (see `.env.example`)
- Run `npm run validate-config` before deploy

## Commands

```bash
npm start                    # nodemon dev
npm run start:prod           # production node
npm run validate-config      # check env/config
npm test                     # Playwright e2e
npm run test:db              # database tests
npm run deploy:aws           # Serverless prod deploy
npm run pm2:start            # PM2 production
npm run health:check         # curl localhost:3001/health
```

## Conventions

- Scrapers return normalized torrent objects consumed by search routes — preserve response shape
- Use existing cache services rather than ad-hoc caching
- Log via `middleware/logger.js`; unhandled rejections are caught in `app.js`
- Never commit `.env` or credentials
- CORS is configured for `FRONTEND_URL` (default `http://localhost:3000`)

When invoked, scope changes to `torrent-search-node/`.
