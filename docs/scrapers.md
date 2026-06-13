# Scrapers

This document describes how the scraper layer works: how sources are selected, how pages are fetched and parsed, how Cloudflare and other anti-bot protections are handled, and what each individual scraper does.

---

## Scraper Architecture

```
torrentController
      │
      ▼
torrentScraperService   ← scraper registry (name → module map)
      │
      ├── searchTorrents(website, query, page, options)
      │       └── scrapers/<website>.js(query, page, options)
      │
      ├── searchAllTorrents(query, page, options)
      │       └── [all scrapers in parallel] → merge → deduplicate
      │
      ├── getTorrentDetails(website, url)
      │       └── scraper.getDetails(url)   [if the scraper supports it]
      │
      └── getScraper(name)   → raw module (used by browseTorrents)
```

Every scraper module exports a function with the signature:

```js
async function search(query, page, options) → Array<TorrentResult> | null
```

Where `options` may include:
- `minSeeders` — minimum seeder count to include
- `maxResults` — maximum results to return
- `sort` — sort field / code
- `category` — category filter

A scraper that supports detailed page fetching attaches a `getDetails` property:

```js
search.getDetails = async function(url) → TorrentDetails
```

A scraper that supports category browsing (no search query) attaches a `browse` property:

```js
search.browse = async function(category, page, sort, options) → Array<TorrentResult>
```

---

## Result Shape

All scrapers normalise results to this common shape:

```js
{
  Name:         string,   // Torrent title
  Size:         string,   // e.g. "4.7 GB"
  Seeders:      string,   // integer as string
  Leechers:     string,
  DateUploaded: string,
  Category:     string,
  Url:          string,   // Detail page URL (not a download link)
  MagnetLink:   string,   // magnet: URI (when available without an extra page fetch)
  Source:       string,   // e.g. "piratebay"
}
```

Detail responses additionally include:

```js
{
  description: string,
  magnet:      string,
  hash:        string,
  files:       [{ name, size }],
  images:      [{ originalUrl, directUrl }],
  // ...site-specific extras
}
```

---

## Individual Scrapers

### pirateBay (`services/scrapers/pirateBay.js`)

Uses the Pirate Bay JSON API (`apibay.org`). No HTML parsing required. Supports:
- Search with optional `sort` and `category` query parameters.
- `browse(category, page, sort, options)` — fetches the top torrents in a category.

The Pirate Bay API returns torrents with `info_hash` but not always a direct magnet link; the scraper constructs the `magnet:` URI from the hash and the standard tracker list.

### 1337x (`services/scrapers/1337x.js`)

1337x.to is behind Cloudflare. This scraper routes every HTTP request through an upstream **FlareSolverr** instance, which uses a headless browser to solve the Cloudflare challenge and return the rendered HTML.

Configuration:
- `FLARESOLVERR_URL` — required env var pointing to your FlareSolverr instance (e.g. `http://localhost:8191/v1`). The scraper will throw an error on first use if this is not set.
- `FLARESOLVERR_MAX_TIMEOUT` — 55 000 ms (keep below platform timeouts).

Anti-bot handling details:
- FlareSolverr sessions are created before a batch of requests and destroyed after to free browser memory.
- Category filtering is appended to the search query text rather than using `/category-search/` URLs (which Cloudflare blocks).
- Local post-processing handles sorting by seeders / size since sort URLs are also blocked.
- Error pages and "No results" pages are detected from the HTML and handled gracefully (returns `[]` rather than throwing).
- A `diagnose()` function tests FlareSolverr reachability, 1337x access, and a sample search; exposed via `GET /health/1337x`.

### YTS (`services/scrapers/yts.js`)

Uses the YTS JSON API (`yts.mx/api/v2`). Movies only. Returns high-quality torrent packs with multiple resolutions per result. No HTML parsing.

### Nyaa.si (`services/scrapers/nyaaSI.js`)

Parses Nyaa.si search results. Primarily for anime, manga, and Japanese media. Uses Cheerio to parse the results table.

### LimeTorrents (`services/scrapers/limeTorrent.js`)

HTML scraper using Cheerio. Parses the LimeTorrents search results page.

### TorrentProject (`services/scrapers/torrentProject.js`)

HTML scraper using Cheerio. Parses TorrentProject search results.

### TheHiddenBay (`services/scrapers/hiddenbay.js`)

HTML scraper for TheHiddenBay. Supports `browse(category, page, sort, options)` for category-based browsing. Also supports `getDetails(url)` for full torrent page fetching.

### Pornrips (`services/scrapers/pornrips.js`)

HTML scraper using Cheerio for Pornrips.

---

## FlareSolverr Integration

FlareSolverr is a self-hosted proxy server that uses a headless Chromium browser (via Selenium/undetected-chromedriver) to solve Cloudflare challenges and return the real HTML response.

### How it works

1. The 1337x scraper POSTs a `request.get` command to `FLARESOLVERR_URL`.
2. FlareSolverr loads the target URL in a headless browser.
3. If a Cloudflare challenge is detected, FlareSolverr solves it automatically.
4. The solved HTML (plus cookies) is returned to the scraper.
5. Cheerio parses the HTML to extract search results.

### Session management

FlareSolverr supports persistent sessions (keeping a browser tab open across multiple requests to the same domain). The scraper creates a session for multi-request operations and destroys it when done.

### Resource considerations

Each FlareSolverr request launches a headless browser tab. Running many parallel requests is memory-intensive. The scraper avoids parallelism within a single search request for this reason.

### Graceful degradation

If `FLARESOLVERR_URL` is not set, the `flareSolverrRequest` function throws immediately with a clear error message. The search function catches this, logs an error, and returns `null` (treated by `torrentScraperService` as "unavailable"). Other scrapers continue to work normally.

---

## Image Extraction from Descriptions

When torrent details are fetched, the description HTML often contains links to image hosting sites. `services/imageExtractorService.js` is called to extract usable direct image URLs.

The extractors handle:
- **Imgur** — `i.imgur.com` direct URLs and album pages.
- **imgbb** — `ibb.co` and `i.ibb.co` hosted images.
- **PostImg** — `postimg.cc` image pages.
- **imgtraffic / trafficimage** — extract the actual image path from the hosting page HTML.
- **fastpic** — `fastpic.org` hosted images.
- **xxxwebdlxxx** — custom extractor for a specific image hosting pattern.

Each extractor handles one or more URL patterns and resolves them to a `{ originalUrl, directUrl }` pair. Extractors that need to fetch a host page do so with a standard `axios` request (no anti-bot bypass needed).
