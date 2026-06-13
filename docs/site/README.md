# Torrent Search API — Marketing Site

This directory contains the static assets for the GitHub Pages landing page served at `https://akshatsinghkaushik.github.io/stream-backend/`.

## Files

| File | Purpose |
|---|---|
| `favicon.svg` | Browser tab icon (OLED dark, green terminal arrow) |
| `og-image.svg` | Open Graph / Twitter card preview image (1200x630) |
| `robots.txt` | Search engine crawl directives |
| `sitemap.xml` | XML sitemap for all docs pages |
| `site.webmanifest` | PWA web app manifest |

## Design

- **Background:** `#0F172A` (OLED dark)
- **Surfaces:** `#1E293B` / `#334155`
- **Accent:** `#22C55E` (run-green, terminal aesthetic)
- **Fonts:** JetBrains Mono (headings/code) + IBM Plex Sans (body)

The landing page (`docs/index.html`) uses Tailwind via Play CDN — no build step needed. All colours and fonts are configured in `window.tailwind.config` before the CDN script loads.

## Updating

The landing page is automatically published when changes are pushed to the `master` branch. GitHub Pages serves the `docs/` directory.
