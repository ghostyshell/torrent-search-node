---
name: local-workflow
description: Local development workflow for torrent-search-node. Use when committing, pushing, or syncing changes.
---

## Git Remotes

This repo has **two remotes** configured:

| Remote | URL | Purpose |
|--------|-----|---------|
| `origin` | `https://github.com/akshatsinghkaushik/torrent-search-node.git` | **Sliplane deployment source** — primary remote for CI/CD and production deployments |
| `alt` | `https://github.com/ghostyshell/torrent-search-node.git` | **Public open-source mirror** — community-facing repository |

## Pushing Changes

**Always push to both remotes together** to keep them in sync:

```bash
# After committing, push to both remotes
git push origin master && git push alt master

# Or push a specific branch to both
git push origin <branch> && git push alt <branch>
```

## Pulling Changes

Pull from `origin` (the deployment source is authoritative):

```bash
git pull origin master
```

## Sync Workflow

If `alt` ever falls behind:

```bash
# Fetch latest from origin
git fetch origin

# Push to alt to sync
git push alt master
```

## Never

- Do not push to only one remote — always sync both
- Do not remove or rename either remote
- Do not change the remote URLs without confirmation
